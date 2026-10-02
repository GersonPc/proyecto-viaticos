import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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

const accountEnvironment = () => {
	const database = new DatabaseSync(':memory:');
	database.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
	const env = {
		ACCOUNTS_DB: {
			prepare: (sql: string) => ({
				bind: (...params: SQLInputValue[]) => ({ first: async () => database.prepare(sql).get(...params) ?? null }),
			}),
		},
	} as unknown as Env;
	return { env, database };
};

const accountData = { name: 'Nueva Persona', account: { number: '001234', type: 'Ahorros', bank: 'Banco de prueba' } };
const accountRequest = (data: unknown = accountData, origin = 'https://example.com') =>
	new Request('https://example.com/api/me?email=other@tecnasa.com', {
		method: 'PUT',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});

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
					first: async () => objects.get(params[0] as string) ?? null,
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
			context(' Me@TECNASA.COM '),
		);
		expect(response.status).toBe(200);
		expect(getLookedUpEmail()).toBe('me@tecnasa.com');
		expect(await response.json()).toEqual({
			name: 'Persona de prueba',
			account: { number: '00123', type: 'Ahorros', bank: 'Banco de prueba' },
		});
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('permite la captura manual solo cuando el registro carece de cuenta', async () => {
		const { env } = environment({ name: 'Persona de prueba', account_number: null, account_type: null, bank: null });
		const response = await handleRequest(new Request('https://example.com/api/me'), env, context('me@tecnasa.com'));
		expect(await response.json()).toEqual({ name: 'Persona de prueba', account: null });
	});

	it('permite entrar a un correo corporativo ausente del listado', async () => {
		const response = await handleRequest(new Request('https://example.com/api/me'), environment().env, context('unknown@tecnasa.com'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: '', account: null });
	});

	it.each(['me@example.com', 'me@sub.tecnasa.com', 'me@tecnasa.com.evil.test', 'me@eviltecnasa.com', 'me@tecnasa.com@tecnasa.com'])(
		'rechaza el dominio ajeno %s incluso si figura en D1',
		async (email) => {
			const { env, getLookedUpEmail } = environment({ name: 'Persona de prueba' });
			const response = await handleRequest(new Request('https://example.com/api/me'), env, context(email));
			expect(response.status).toBe(403);
			expect(getLookedUpEmail()).toBe('');
		},
	);

	it('registra una cuenta nueva, preserva ceros y la recupera solo para su dueño', async () => {
		const { env, database } = accountEnvironment();
		try {
			const saved = await handleRequest(accountRequest({ ...accountData, email: 'other@tecnasa.com' }), env, context('new@tecnasa.com'));
			expect(saved.status).toBe(200);
			expect(saved.headers.get('Cache-Control')).toBe('no-store');
			expect(await saved.json()).toEqual(accountData);
			const loaded = await handleRequest(new Request('https://example.com/api/me'), env, context('new@tecnasa.com'));
			expect(await loaded.json()).toEqual(accountData);
			const other = await handleRequest(new Request('https://example.com/api/me?email=new@tecnasa.com'), env, context('other@tecnasa.com'));
			expect(await other.json()).toEqual({ name: '', account: null });
		} finally {
			database.close();
		}
	});

	it('completa una cuenta vacía conservando el nombre del listado y no permite reemplazarla', async () => {
		const { env, database } = accountEnvironment();
		try {
			database.exec("INSERT INTO employee_accounts (email, name) VALUES ('me@tecnasa.com', 'Nombre del listado')");
			const saved = await handleRequest(accountRequest(), env, context('me@tecnasa.com'));
			expect(await saved.json()).toEqual({ ...accountData, name: 'Nombre del listado' });
			const replacement = await handleRequest(
				accountRequest({ ...accountData, account: { ...accountData.account, number: '999' } }),
				env,
				context('me@tecnasa.com'),
			);
			expect(replacement.status).toBe(409);
			const loaded = await handleRequest(new Request('https://example.com/api/me'), env, context('me@tecnasa.com'));
			expect(await loaded.json()).toEqual({ ...accountData, name: 'Nombre del listado' });
		} finally {
			database.close();
		}
	});

	it('rechaza registro sin sesión, de otro dominio o desde otro origen', async () => {
		const { env, database } = accountEnvironment();
		try {
			expect((await handleRequest(accountRequest(), env, context())).status).toBe(401);
			expect((await handleRequest(accountRequest(), env, context('me@example.com'))).status).toBe(403);
			expect((await handleRequest(accountRequest(accountData, 'https://evil.test'), env, context('me@tecnasa.com'))).status).toBe(403);
			expect(database.prepare('SELECT COUNT(*) AS count FROM employee_accounts').get()?.count).toBe(0);
		} finally {
			database.close();
		}
	});

	it.each([
		null,
		{},
		{ ...accountData, name: ' ' },
		{ ...accountData, name: 'x'.repeat(101) },
		{ ...accountData, account: { ...accountData.account, number: 1234 } },
		{ ...accountData, account: { ...accountData.account, bank: '' } },
	])('rechaza datos incompletos o inválidos sin guardar', async (data) => {
		const { env, database } = accountEnvironment();
		try {
			expect((await handleRequest(accountRequest(data), env, context('me@tecnasa.com'))).status).toBe(400);
			expect(database.prepare('SELECT COUNT(*) AS count FROM employee_accounts').get()?.count).toBe(0);
		} finally {
			database.close();
		}
	});

	it('rechaza JSON inválido y cuerpos demasiado grandes', async () => {
		const { env, database } = accountEnvironment();
		try {
			for (const [body, status] of [
				['{', 400],
				['x'.repeat(4097), 413],
			] as const) {
				const request = new Request('https://example.com/api/me', {
					method: 'PUT',
					headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
					body,
				});
				expect((await handleRequest(request, env, context('me@tecnasa.com'))).status).toBe(status);
			}
		} finally {
			database.close();
		}
	});

	it('valida firma, emisor y audiencia del token de Access antes de consultar D1', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
		const fetchKeys = vi.fn(
			async () => new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'Content-Type': 'application/json' } }),
		);
		vi.stubGlobal('fetch', fetchKeys);
		const makeToken = (audience: string) =>
			new SignJWT({ email: 'me@tecnasa.com', type: 'app' })
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
		expect(getLookedUpEmail()).toBe('me@tecnasa.com');
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
		const saved = await handleRequest(signatureRequest('PUT', png), env, context('owner@tecnasa.com'));
		expect(saved.status).toBe(200);
		expect(objects.size).toBe(1);
		expect([...objects.keys()][0]).not.toContain('owner@tecnasa.com');
		const loaded = await handleRequest(signatureRequest('GET'), env, context('owner@tecnasa.com'));
		expect(loaded.status).toBe(200);
		expect(loaded.headers.get('Content-Type')).toBe('image/png');
		expect(loaded.headers.get('Cache-Control')).toBe('no-store');
		expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(png);
		const removed = await handleRequest(signatureRequest('DELETE'), env, context('owner@tecnasa.com'));
		expect(removed.status).toBe(204);
		expect(write).toHaveBeenCalledTimes(2);
		expect((await handleRequest(signatureRequest('GET'), env, context('owner@tecnasa.com'))).status).toBe(204);
	});

	it('rechaza firmas de personas sin sesión o de otro dominio', async () => {
		const { env, write } = signatureEnvironment();
		expect((await handleRequest(signatureRequest('PUT', png), env, context())).status).toBe(401);
		expect((await handleRequest(signatureRequest('PUT', png), env, context('other@example.com'))).status).toBe(403);
		expect(write).not.toHaveBeenCalled();
	});

	it('rechaza origen ajeno, archivo falso y firma demasiado grande', async () => {
		const { env, write } = signatureEnvironment();
		expect((await handleRequest(signatureRequest('PUT', png, 'https://other.example.com'), env, context('owner@tecnasa.com'))).status).toBe(
			403,
		);
		expect((await handleRequest(signatureRequest('PUT', new Uint8Array([1, 2, 3])), env, context('owner@tecnasa.com'))).status).toBe(415);
		expect((await handleRequest(signatureRequest('PUT', new Uint8Array(1_500_001)), env, context('owner@tecnasa.com'))).status).toBe(413);
		expect(write).not.toHaveBeenCalled();
	});
});
