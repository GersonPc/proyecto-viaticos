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

const signatureEnvironment = () => {
	const objects = new Map<string, { image: number[]; content_type: string }>();
	const write = vi.fn(async (sql: string, params: unknown[]) => {
		if (sql.startsWith('DELETE')) objects.delete(params[0] as string);
		if (sql.startsWith('INSERT'))
			objects.set(params[0] as string, { content_type: params[1] as string, image: [...(params[2] as Uint8Array)] });
	});
	const env = {
		ACCOUNTS_DB: {
			prepare: (sql: string) => ({
				bind: (...params: unknown[]) => ({
					first: async () =>
						sql.startsWith('SELECT 1')
							? params[0] === 'owner@example.com'
								? { allowed: 1 }
								: null
							: (objects.get(params[0] as string) ?? null),
					run: () => write(sql, params),
				}),
			}),
		},
	} as unknown as Env;
	return { env, write, objects };
};

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const signatureRequest = (method: string, body?: Uint8Array, origin = 'https://example.com') => {
	const buffer = body ? new ArrayBuffer(body.byteLength) : undefined;
	if (buffer && body) new Uint8Array(buffer).set(body);
	return new Request('https://example.com/api/signature?email=other@example.com', {
		method,
		headers: { Origin: origin, 'Content-Type': 'image/png' },
		body: buffer,
	});
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

	it('guarda, recupera y elimina solo la firma del correo verificado', async () => {
		const { env, write, objects } = signatureEnvironment();
		const saved = await handleRequest(signatureRequest('PUT', png), env, context('owner@example.com'));
		expect(saved.status).toBe(200);
		expect(objects.size).toBe(1);
		expect([...objects.keys()][0]).not.toContain('owner@example.com');
		const loaded = await handleRequest(signatureRequest('GET'), env, context('owner@example.com'));
		expect(loaded.status).toBe(200);
		expect(loaded.headers.get('Content-Type')).toBe('image/png');
		expect(loaded.headers.get('Cache-Control')).toBe('no-store');
		expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(png);
		const removed = await handleRequest(signatureRequest('DELETE'), env, context('owner@example.com'));
		expect(removed.status).toBe(204);
		expect(write).toHaveBeenCalledTimes(2);
		expect((await handleRequest(signatureRequest('GET'), env, context('owner@example.com'))).status).toBe(204);
	});

	it('rechaza firmas de personas sin sesión o ausentes del directorio', async () => {
		const { env, write } = signatureEnvironment();
		expect((await handleRequest(signatureRequest('PUT', png), env, context())).status).toBe(401);
		expect((await handleRequest(signatureRequest('PUT', png), env, context('other@example.com'))).status).toBe(404);
		expect(write).not.toHaveBeenCalled();
	});

	it('rechaza origen ajeno, archivo falso y firma demasiado grande', async () => {
		const { env, write } = signatureEnvironment();
		expect((await handleRequest(signatureRequest('PUT', png, 'https://other.example.com'), env, context('owner@example.com'))).status).toBe(
			403,
		);
		expect((await handleRequest(signatureRequest('PUT', new Uint8Array([1, 2, 3])), env, context('owner@example.com'))).status).toBe(415);
		expect((await handleRequest(signatureRequest('PUT', new Uint8Array(1_500_001)), env, context('owner@example.com'))).status).toBe(413);
		expect(write).not.toHaveBeenCalled();
	});
});
