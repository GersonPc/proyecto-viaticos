import { createRemoteJWKSet, jwtVerify } from 'jose';

type AccountEnv = Env & { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string };
type AccountRow = { name: string; account_number: string | null; account_type: string | null; bank: string | null };

const MAX_SIGNATURE_BYTES = 1_500_000;
const signatureTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: privateHeaders });
}

async function verifiedEmail(request: Request, env: AccountEnv, ctx: ExecutionContext): Promise<string | null> {
	// Access supplies this context only when it directly invokes the Worker. Static Assets
	// currently strips it, so the signed assertion is also verified below.
	if (ctx.access) {
		const email = (await ctx.access.getIdentity())?.email;
		return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
	}

	const token = request.headers.get('Cf-Access-Jwt-Assertion');
	const domain = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
	const audience = env.ACCESS_AUD?.trim();
	if (!token || !domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience || audience === 'CONFIGURE_BEFORE_DEPLOY') {
		return null;
	}

	try {
		let keys = keySets.get(domain);
		if (!keys) {
			keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
			keySets.set(domain, keys);
		}
		const { payload } = await jwtVerify(token, keys, {
			issuer: `https://${domain}`,
			audience,
			algorithms: ['RS256'],
		});
		if (payload.type !== 'app' || typeof payload.email !== 'string' || !payload.email.trim()) return null;
		return payload.email.trim().toLowerCase();
	} catch {
		return null;
	}
}

async function signatureKey(email: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
	return `signatures/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function hasImageSignature(bytes: Uint8Array, contentType: string): boolean {
	if (contentType === 'image/png') {
		return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
	}
	if (contentType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	return (
		contentType === 'image/webp' &&
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	);
}

async function readSignature(request: Request): Promise<Uint8Array | null> {
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_SIGNATURE_BYTES) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function handleSignature(request: Request, env: AccountEnv, email: string): Promise<Response> {
	if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Método no permitido.' }, 405);
	if (!env.ACCOUNTS_DB) return json({ error: 'El almacenamiento de firmas no está disponible.' }, 503);
	try {
		const collaborator = await env.ACCOUNTS_DB.prepare('SELECT 1 AS allowed FROM employee_accounts WHERE email = ? LIMIT 1')
			.bind(email)
			.first<{ allowed: number }>();
		if (!collaborator) return json({ error: 'Tu correo no aparece en el listado de colaboradores.' }, 404);

		const key = await signatureKey(email);
		if (request.method === 'GET') {
			const row = await env.ACCOUNTS_DB.prepare('SELECT content_type, image FROM employee_signatures WHERE key = ? LIMIT 1')
				.bind(key)
				.first<{ content_type: string; image: number[] }>();
			if (!row) return new Response(null, { status: 204, headers: privateHeaders });
			if (!signatureTypes.has(row.content_type)) return json({ error: 'La firma guardada no se pudo abrir.' }, 503);
			return new Response(new Uint8Array(row.image), { headers: { ...privateHeaders, 'Content-Type': row.content_type } });
		}

		if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Origen no permitido.' }, 403);
		if (request.method === 'DELETE') {
			await env.ACCOUNTS_DB.prepare('DELETE FROM employee_signatures WHERE key = ?').bind(key).run();
			return new Response(null, { status: 204, headers: privateHeaders });
		}

		const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
		if (!signatureTypes.has(contentType)) return json({ error: 'La firma debe ser PNG, JPG o WebP.' }, 415);
		if (Number(request.headers.get('Content-Length')) > MAX_SIGNATURE_BYTES)
			return json({ error: 'La firma guardada supera el tamaño permitido.' }, 413);
		const bytes = await readSignature(request);
		if (!bytes || bytes.byteLength === 0) return json({ error: 'La firma guardada supera el tamaño permitido o está vacía.' }, 413);
		if (!hasImageSignature(bytes, contentType)) return json({ error: 'El archivo no corresponde a una imagen válida.' }, 415);
		await env.ACCOUNTS_DB.prepare(
			'INSERT INTO employee_signatures (key, content_type, image) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET content_type = excluded.content_type, image = excluded.image',
		)
			.bind(key, contentType, bytes)
			.run();
		return json({ saved: true });
	} catch {
		return json({ error: 'No se pudo administrar la firma. Intenta de nuevo.' }, 503);
	}
}

export async function handleRequest(request: Request, env: AccountEnv, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname === '/api/' || url.pathname === '/api/health') {
		return json({ status: 'ok', message: 'Entorno de desarrollo listo' });
	}

	if (url.pathname !== '/api/me' && url.pathname !== '/api/signature') return new Response(null, { status: 404 });
	if (url.pathname === '/api/me' && request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);

	const email = await verifiedEmail(request, env, ctx);
	if (!email) return json({ error: 'Inicia sesión para consultar tus datos.' }, 401);
	if (url.pathname === '/api/signature') return handleSignature(request, env, email);
	if (!env.ACCOUNTS_DB) return json({ error: 'El directorio de cuentas no está disponible.' }, 503);

	try {
		const row = await env.ACCOUNTS_DB.prepare(
			'SELECT name, account_number, account_type, bank FROM employee_accounts WHERE email = ? LIMIT 1',
		)
			.bind(email)
			.first<AccountRow>();
		if (!row) return json({ error: 'Tu correo no aparece en el listado de colaboradores.' }, 404);
		return json({
			name: row.name,
			account: row.account_number ? { number: row.account_number, type: row.account_type, bank: row.bank } : null,
		});
	} catch {
		return json({ error: 'No se pudieron consultar tus datos. Intenta de nuevo.' }, 503);
	}
}

export default {
	fetch(request, env, ctx): Promise<Response> {
		return handleRequest(request, env as AccountEnv, ctx);
	},
} satisfies ExportedHandler<Env>;
