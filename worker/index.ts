import { createRemoteJWKSet, jwtVerify } from 'jose';

type AccountEnv = Env & { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string };
type AccountRow = { name: string; account_number: string | null; account_type: string | null; bank: string | null };

const privateHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
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

export async function handleRequest(request: Request, env: AccountEnv, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname === '/api/' || url.pathname === '/api/health') {
		return json({ status: 'ok', message: 'Entorno de desarrollo listo' });
	}

	if (url.pathname !== '/api/me') return new Response(null, { status: 404 });
	if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);

	const email = await verifiedEmail(request, env, ctx);
	if (!email) return json({ error: 'Inicia sesión para consultar tus datos.' }, 401);
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
