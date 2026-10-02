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

async function readBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
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

async function handleAccount(request: Request, env: AccountEnv, email: string): Promise<Response> {
	if (!env.ACCOUNTS_DB) return json({ error: 'El directorio de cuentas no está disponible.' }, 503);
	try {
		if (request.method === 'PUT') {
			if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Origen no permitido.' }, 403);
			if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
				return json({ error: 'Envía los datos de la cuenta en formato JSON.' }, 415);
			}
			const bytes = await readBody(request, 4096);
			if (!bytes) return json({ error: 'Los datos de la cuenta superan el tamaño permitido.' }, 413);
			let data;
			try {
				data = JSON.parse(new TextDecoder().decode(bytes));
			} catch {
				return json({ error: 'Los datos de la cuenta no son válidos.' }, 400);
			}
			const values = [data?.name, data?.account?.number, data?.account?.type, data?.account?.bank];
			const limits = [100, 40, 40, 80];
			if (
				values.some(
					(value, index) =>
						typeof value !== 'string' ||
						!value.trim() ||
						value.trim().length > limits[index] ||
						Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
				)
			) {
				return json({ error: 'Completa nombre, número, tipo y banco con datos válidos.' }, 400);
			}
			// Only the verified owner may fill an empty account. The conditional write
			// also prevents simultaneous registrations from replacing a saved account.
			const row = await env.ACCOUNTS_DB.prepare(
				`INSERT INTO employee_accounts (email, name, account_number, account_type, bank) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(email) DO UPDATE SET account_number = excluded.account_number, account_type = excluded.account_type, bank = excluded.bank
				WHERE employee_accounts.account_number IS NULL
				RETURNING name, account_number, account_type, bank`,
			)
				.bind(email, ...values.map((value: string) => value.trim()))
				.first<AccountRow>();
			if (!row) return json({ error: 'Ya tienes una cuenta guardada. Recarga la página para cargarla.' }, 409);
			return json({ name: row.name, account: { number: row.account_number, type: row.account_type, bank: row.bank } });
		}
		const row = await env.ACCOUNTS_DB.prepare(
			'SELECT name, account_number, account_type, bank FROM employee_accounts WHERE email = ? LIMIT 1',
		)
			.bind(email)
			.first<AccountRow>();
		return json({
			name: row?.name ?? '',
			account: row?.account_number ? { number: row.account_number, type: row.account_type, bank: row.bank } : null,
		});
	} catch {
		return json(
			{
				error:
					request.method === 'PUT'
						? 'No se pudo guardar tu cuenta. Intenta de nuevo.'
						: 'No se pudieron consultar tus datos. Intenta de nuevo.',
			},
			503,
		);
	}
}

async function handleSignature(request: Request, env: AccountEnv, email: string): Promise<Response> {
	if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Método no permitido.' }, 405);
	if (!env.ACCOUNTS_DB) return json({ error: 'El almacenamiento de firmas no está disponible.' }, 503);
	try {
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
		const bytes = await readBody(request, MAX_SIGNATURE_BYTES);
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
	if (url.pathname === '/api/me' && !['GET', 'PUT'].includes(request.method)) return json({ error: 'Método no permitido.' }, 405);

	const email = await verifiedEmail(request, env, ctx);
	if (!email) return json({ error: 'Inicia sesión para consultar tus datos.' }, 401);
	if (!/^[^\s@]+@tecnasa\.com$/.test(email)) return json({ error: 'El acceso está disponible solo para correos @tecnasa.com.' }, 403);
	if (url.pathname === '/api/signature') return handleSignature(request, env, email);
	return handleAccount(request, env, email);
}

export default {
	fetch(request, env, ctx): Promise<Response> {
		return handleRequest(request, env as AccountEnv, ctx);
	},
} satisfies ExportedHandler<Env>;
