import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../worker';

const context = (email?: string) =>
	({ access: email ? { getIdentity: async () => ({ email }) } : undefined }) as unknown as ExecutionContext;

const environment = (row: Record<string, string | null> | null = null) => {
	let lookedUpEmail = '';
	const env = {
		ACCESS_TEAM_DOMAIN: 'CONFIGURE_BEFORE_DEPLOY',
		ACCESS_AUD: 'CONFIGURE_BEFORE_DEPLOY',
		ACCOUNTS_DB: {
			prepare: () => ({
				bind: (email: string) => ({
					first: async () => {
						lookedUpEmail = email;
						return row;
					},
				}),
			}),
		},
	} as unknown as Env;
	return { env, getLookedUpEmail: () => lookedUpEmail };
};

afterEach(() => vi.unstubAllGlobals());

describe('account directory worker', () => {
	it('expone el estado del entorno', async () => {
		const response = await handleRequest(new Request('https://example.com/api/health'), environment().env, context());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok', message: 'Entorno de desarrollo listo' });
	});

	it('responde 404 fuera de la API', async () => {
		const response = await handleRequest(new Request('https://example.com/no-existe'), environment().env, context());
		expect(response.status).toBe(404);
	});

	it('no confía en correos suministrados por el navegador', async () => {
		const { env, getLookedUpEmail } = environment();
		const response = await handleRequest(
			new Request('https://example.com/api/me?email=other@example.com', {
				headers: { 'Cf-Access-Authenticated-User-Email': 'other@example.com' },
			}),
			env,
			context(),
		);
		expect(response.status).toBe(401);
		expect(getLookedUpEmail()).toBe('');
	});

	it('consulta solo el correo autenticado y devuelve su cuenta', async () => {
		const { env, getLookedUpEmail } = environment({
			name: 'Persona de prueba',
			account_number: '00123',
			account_type: 'Ahorros',
			bank: 'Banco de prueba',
		});
		const response = await handleRequest(
			new Request('https://example.com/api/me?email=other@example.com'),
			env,
			context(' Me@Example.com '),
		);
		expect(response.status).toBe(200);
		expect(getLookedUpEmail()).toBe('me@example.com');
		expect(await response.json()).toEqual({
			name: 'Persona de prueba',
			account: { number: '00123', type: 'Ahorros', bank: 'Banco de prueba' },
		});
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('permite la captura manual solo cuando el registro carece de cuenta', async () => {
		const { env } = environment({ name: 'Persona de prueba', account_number: null, account_type: null, bank: null });
		const response = await handleRequest(new Request('https://example.com/api/me'), env, context('me@example.com'));
		expect(await response.json()).toEqual({ name: 'Persona de prueba', account: null });
	});

	it('no permite seleccionar una persona ausente del listado', async () => {
		const response = await handleRequest(new Request('https://example.com/api/me'), environment().env, context('unknown@example.com'));
		expect(response.status).toBe(404);
	});

	it('valida firma, emisor y audiencia del token de Access antes de consultar D1', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
		const fetchKeys = vi.fn(
			async () => new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'Content-Type': 'application/json' } }),
		);
		vi.stubGlobal('fetch', fetchKeys);
		const makeToken = (audience: string) =>
			new SignJWT({ email: 'me@example.com', type: 'app' })
				.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
				.setIssuer('https://test.cloudflareaccess.com')
				.setAudience(audience)
				.setIssuedAt()
				.setExpirationTime('5m')
				.sign(privateKey);
		const { env, getLookedUpEmail } = environment({
			name: 'Persona de prueba',
			account_number: '00123',
			account_type: 'Ahorros',
			bank: 'Banco de prueba',
		});
		Object.assign(env, { ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'expected-audience' });
		const valid = await handleRequest(
			new Request('https://example.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': await makeToken('expected-audience') } }),
			env,
			context(),
		);
		expect(valid.status).toBe(200);
		expect(getLookedUpEmail()).toBe('me@example.com');
		const wrongAudience = await handleRequest(
			new Request('https://example.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': await makeToken('other-audience') } }),
			env,
			context(),
		);
		expect(wrongAudience.status).toBe(401);
		const forged = await handleRequest(
			new Request('https://example.com/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'forged.token.value' } }),
			env,
			context(),
		);
		expect(forged.status).toBe(401);
		expect(fetchKeys).toHaveBeenCalledTimes(1);
	});
});
