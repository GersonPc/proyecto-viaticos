import { initialLiquidation, type LiquidationRecord } from '../src/liquidation';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { handleRequest } from '../worker';
import { initialForm } from '../src/request';
import { type SubmittedRequest, type RequestDetail, type RequestList, parseSnapshot } from '../src/workflow';

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function setup() {
	const database = new DatabaseSync(':memory:');
	databases.push(database);
	database.exec('PRAGMA foreign_keys=ON');
	for (const migration of ['0001_accounts', '0002_signatures', '0003_requests', '0004_liquidations'])
		database.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
	database.exec("INSERT INTO employee_accounts VALUES ('user@tecnasa.com','Nombre verificado','00123','Ahorros','Banco privado')");
	let failChunk = false;
	const prepare = (sql: string) => {
		let args: SQLInputValue[] = [];
		const all = async () => {
			if (failChunk && (sql.startsWith('INSERT INTO request_snapshot_chunks') || sql.startsWith('INSERT INTO liquidation_chunks')))
				throw new Error('storage failure');
			return { results: database.prepare(sql).all(...args) };
		};
		return {
			bind(...params: SQLInputValue[]) {
				args = params;
				return this;
			},
			all,
			first: async () => (await all()).results[0] ?? null,
		};
	};
	const env = {
		ACCOUNTS_DB: {
			prepare,
			batch: async (statements: ReturnType<typeof prepare>[]) => {
				database.exec('BEGIN');
				try {
					const results = [];
					for (const statement of statements) results.push(await statement.all());
					database.exec('COMMIT');
					return results;
				} catch (e) {
					database.exec('ROLLBACK');
					throw e;
				}
			},
		},
	} as unknown as Env;
	const call = (path: string, method = 'GET', data?: unknown, email = 'user@tecnasa.com', origin = 'https://example.com') =>
		handleRequest(
			new Request(`https://example.com${path}`, {
				method,
				...(method !== 'GET' ? { headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
			}),
			env,
			{ access: email ? { getIdentity: async () => ({ email }) } : undefined } as unknown as ExecutionContext,
		);
	return {
		database,
		call,
		failWrites: () => {
			failChunk = true;
		},
	};
}
const snapshot = () => ({
	schemaVersion: 1,
	signature: '',
	request: {
		...structuredClone(initialForm.request),
		date: '2026-10-02',
		departureDate: '2026-10-05',
		returnDate: '2026-10-06',
		concept: 'Visitar cliente',
		clients: ['Cliente'],
		destinations: ['Guatemala'],
		serviceTickets: ['123'],
		meals: { '2026-10-05': { breakfast: true, lunch: true } },
		images: [
			{
				id: 'map1',
				name: 'ruta.png',
				src: 'data:image/png;base64,iVBORw0KGgo=',
				kind: 'route',
				kilometers: '10.25',
				price: '',
				date: '2026-10-05',
			},
		],
	},
});
const submission = () => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), snapshot: snapshot() });
async function create(call: ReturnType<typeof setup>['call']) {
	const data = submission();
	const response = await call('/api/requests', 'POST', data);
	expect(response.status).toBe(201);
	return { item: (await response.json()) as SubmittedRequest, data };
}
const review = (call: ReturnType<typeof setup>['call'], item: SubmittedRequest, status: string, reason = '') =>
	call(`/api/admin/requests/${item.id}/review`, 'POST', { revision: item.revision, status, reason }, 'gpac@tecnasa.com');

describe('persistencia y revisión de viáticos', () => {
	it('guarda el nombre verificado, calcula los totales y oculta cuenta, firma y mapas en la tabla administrativa', async () => {
		const { call } = setup();
		const data = submission();
		Object.assign(data, { name: 'Nombre falso', owner: 'other@tecnasa.com', totalCents: 1 });
		const sent = await call('/api/requests', 'POST', data);
		expect(sent.status).toBe(201);
		const item = (await sent.json()) as SubmittedRequest;
		expect(item.name).toBe('Nombre verificado');
		expect(item.totalCents).toBe(13833);
		expect(item.kilometers).toBe(10.25);
		const listing = await call('/api/admin/requests?status=pending', 'GET', undefined, 'gpac@tecnasa.com');
		const text = JSON.stringify(await listing.json());
		for (const secret of ['00123', 'Banco privado', 'owner_email', 'image/png', 'signature', 'account_number', 'submission_key'])
			expect(text).not.toContain(secret);
		const detail = await call(`/api/requests/${item.id}`);
		expect(((await detail.json()) as RequestDetail).snapshot).toEqual(data.snapshot);
	});
	it('rechaza sin motivo, permite corregir y reenviar la misma solicitud y conserva cada revisión', async () => {
		const { call, database } = setup();
		const { item, data } = await create(call);
		const rejected = await review(call, item, 'rejected');
		expect(rejected.status).toBe(200);
		const rejection = (await rejected.json()) as SubmittedRequest;
		const detail = await call(`/api/requests/${item.id}`);
		expect(((await detail.json()) as RequestDetail).snapshot).toEqual(data.snapshot);
		const corrected = snapshot();
		corrected.request.concept = 'Objetivo corregido';
		const resendData = { revision: rejection.revision, key: crypto.randomUUID(), snapshot: corrected };
		const resent = await call(`/api/requests/${item.id}`, 'PUT', resendData);
		expect(resent.status).toBe(200);
		const pending = (await resent.json()) as SubmittedRequest;
		expect(pending.id).toBe(item.id);
		expect(pending.status).toBe('pending');
		expect(pending.revision).toBe(3);
		const restored = await call(`/api/requests/${item.id}`);
		expect(((await restored.json()) as RequestDetail).snapshot).toEqual(corrected);
		expect(database.prepare('SELECT status, actor_email FROM request_events ORDER BY id').all()).toEqual([
			{ status: 'pending', actor_email: 'user@tecnasa.com' },
			{ status: 'rejected', actor_email: 'gpac@tecnasa.com' },
			{ status: 'pending', actor_email: 'user@tecnasa.com' },
		]);
		expect(database.prepare('SELECT COUNT(DISTINCT revision) AS n FROM request_snapshot_chunks').get()?.n).toBe(2);
	});
	it('acepta, mueve de bandeja y prohíbe editar o revisar de nuevo una aceptada', async () => {
		const { call } = setup();
		const { item } = await create(call);
		expect((await review(call, item, 'accepted')).status).toBe(200);
		expect((await review(call, item, 'rejected')).status).toBe(409);
		expect((await call(`/api/requests/${item.id}`, 'PUT', { key: crypto.randomUUID(), revision: 2, snapshot: snapshot() })).status).toBe(
			409,
		);
		expect(
			((await (await call('/api/admin/requests?status=pending', 'GET', undefined, 'gpac@tecnasa.com')).json()) as RequestList).requests,
		).toHaveLength(0);
		expect(
			((await (await call('/api/admin/requests?status=accepted', 'GET', undefined, 'gpac@tecnasa.com')).json()) as RequestList).requests,
		).toHaveLength(1);
	});
	it('solo la primera revisión simultánea prevalece', async () => {
		const { call, database } = setup();
		const { item } = await create(call);
		const results = await Promise.all([review(call, item, 'accepted'), review(call, item, 'rejected')]);
		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		expect(database.prepare('SELECT COUNT(*) AS n FROM request_events').get()?.n).toBe(2);
	});
	it('no duplica un envío reintentado y no permite cambiar el contenido de ese reintento', async () => {
		const { call, database } = setup();
		const { item, data } = await create(call);
		expect((await call('/api/requests', 'POST', data)).status).toBe(201);
		const altered = structuredClone(data);
		altered.snapshot.request.concept = 'otro';
		expect((await call('/api/requests', 'POST', altered)).status).toBe(409);
		expect(database.prepare('SELECT COUNT(*) AS n FROM travel_requests').get()?.n).toBe(1);
		expect(database.prepare('SELECT COUNT(*) AS n FROM request_events').get()?.n).toBe(1);
		expect(((await (await call(`/api/requests/${item.id}`)).json()) as RequestDetail).snapshot).toEqual(data.snapshot);
	});
	it('un reintento después de una decisión sigue siendo idempotente', async () => {
		const { call, database } = setup();
		const { item, data } = await create(call);
		await review(call, item, 'accepted');
		expect((await call('/api/requests', 'POST', data)).status).toBe(201);
		expect(database.prepare('SELECT COUNT(*) AS n FROM request_events').get()?.n).toBe(2);
	});
	it('revierte metadatos y auditoría si falla el almacenamiento de imágenes', async () => {
		const { call, database, failWrites } = setup();
		failWrites();
		expect((await call('/api/requests', 'POST', submission())).status).toBe(503);
		expect(database.prepare('SELECT COUNT(*) AS n FROM travel_requests').get()?.n).toBe(0);
		expect(database.prepare('SELECT COUNT(*) AS n FROM request_events').get()?.n).toBe(0);
	});
	it('restaura adjuntos grandes divididos en filas sin perder caracteres Unicode', async () => {
		const { call } = setup();
		const data = submission();
		data.snapshot.request.images[0].src = `data:image/png;base64,${'A'.repeat(600000)}`;
		data.snapshot.request.images[0].name = 'cotización 🚙';
		const response = await call('/api/requests', 'POST', data);
		expect(response.status).toBe(201);
		expect(((await (await call(`/api/requests/${data.id}`)).json()) as RequestDetail).snapshot).toEqual(data.snapshot);
	});
	it('impide leer o reenviar solicitudes de otro empleado', async () => {
		const { call } = setup();
		const { item } = await create(call);
		expect((await call(`/api/requests/${item.id}?email=user@tecnasa.com`, 'GET', undefined, 'other@tecnasa.com')).status).toBe(404);
		await review(call, item, 'rejected');
		expect(
			(await call(`/api/requests/${item.id}`, 'PUT', { revision: 2, key: crypto.randomUUID(), snapshot: snapshot() }, 'gpac@tecnasa.com'))
				.status,
		).toBe(409);
	});
	it('no deja reenviar una revisión antigua después de una nueva corrección', async () => {
		const { call } = setup();
		const { item } = await create(call);
		await review(call, item, 'rejected');
		expect((await call(`/api/requests/${item.id}`, 'PUT', { revision: 2, key: crypto.randomUUID(), snapshot: snapshot() })).status).toBe(
			200,
		);
		expect((await call(`/api/requests/${item.id}`, 'PUT', { revision: 2, key: crypto.randomUUID(), snapshot: snapshot() })).status).toBe(
			409,
		);
	});
	it('pagina por fecha e id sin duplicar solicitudes y filtra nombres literales', async () => {
		const { call } = setup();
		for (let i = 0; i < 53; i++) await create(call);
		const first = (await (await call('/api/admin/requests?status=pending', 'GET', undefined, 'gpac@tecnasa.com')).json()) as RequestList;
		expect(first.requests).toHaveLength(50);
		expect(first.nextCursor).not.toBeNull();
		const second = (await (
			await call(`/api/admin/requests?status=pending&cursor=${encodeURIComponent(first.nextCursor!)}`, 'GET', undefined, 'gpac@tecnasa.com')
		).json()) as RequestList;
		expect(second.requests).toHaveLength(3);
		expect(second.nextCursor).toBeNull();
		expect(new Set([...first.requests, ...second.requests].map((r) => r.id)).size).toBe(53);
		const filtered = (await (await call('/api/requests?name=%25')).json()) as RequestList;
		expect(filtered.requests).toHaveLength(0);
	});
});
describe('permisos y validación de administración', () => {
	it('identifica gpac como principal, sin dar permisos a un correo corporativo cualquiera', async () => {
		const { call } = setup();
		expect(await (await call('/api/session')).json()).toEqual({ isAdmin: false, canManageAdmins: false });
		expect(await (await call('/api/session', 'GET', undefined, ' GPAC@TECNASA.COM ')).json()).toEqual({
			isAdmin: true,
			canManageAdmins: true,
		});
		for (const path of ['/api/admin/requests', '/api/admin/administrators']) expect((await call(path)).status).toBe(403);
	});
	it('solo el principal agrega o quita administradores; quitar acceso impide decisiones posteriores', async () => {
		const { call, database } = setup();
		const { item } = await create(call);
		expect((await call('/api/admin/administrators', 'PUT', { email: 'helper@tecnasa.com' }, 'gpac@tecnasa.com')).status).toBe(200);
		expect((await call('/api/admin/requests', 'GET', undefined, 'helper@tecnasa.com')).status).toBe(200);
		expect((await call('/api/admin/administrators', 'PUT', { email: 'other@tecnasa.com' }, 'helper@tecnasa.com')).status).toBe(403);
		expect((await call('/api/admin/administrators', 'DELETE', { email: 'gpac@tecnasa.com' }, 'gpac@tecnasa.com')).status).toBe(409);
		expect((await call('/api/admin/administrators', 'PUT', { email: 'outside@example.com' }, 'gpac@tecnasa.com')).status).toBe(400);
		expect((await call('/api/admin/administrators', 'DELETE', { email: 'helper@tecnasa.com' }, 'gpac@tecnasa.com')).status).toBe(200);
		expect(
			(await call(`/api/admin/requests/${item.id}/review`, 'POST', { status: 'accepted', revision: 1, reason: '' }, 'helper@tecnasa.com'))
				.status,
		).toBe(403);
		expect(database.prepare('SELECT action FROM administrator_events ORDER BY id').all()).toEqual([
			{ action: 'granted' },
			{ action: 'revoked' },
		]);
	});
	it('rechaza sesión ausente, dominios ajenos, origen ajeno y métodos equivocados', async () => {
		const { call } = setup();
		expect((await call('/api/requests', 'POST', submission(), '')).status).toBe(401);
		expect((await call('/api/requests', 'POST', submission(), 'outside@example.com')).status).toBe(403);
		expect((await call('/api/requests', 'POST', submission(), 'user@tecnasa.com', 'https://evil.test')).status).toBe(403);
		expect((await call('/api/admin/requests', 'POST', submission(), 'gpac@tecnasa.com')).status).toBe(405);
	});
	it.each([
		null,
		{},
		{ schemaVersion: 2 },
		{ ...snapshot(), request: { ...snapshot().request, meals: [] } },
		{ ...snapshot(), request: { ...snapshot().request, returnDate: '2026-10-01' } },
		{ ...snapshot(), request: { ...snapshot().request, images: [{ ...snapshot().request.images[0], kilometers: '-1' }] } },
		{ ...snapshot(), request: { ...snapshot().request, concept: '' } },
	])('rechaza datos inválidos sin persistir: %s', async (value) => {
		const { call, database } = setup();
		expect((await call('/api/requests', 'POST', { ...submission(), snapshot: value })).status).toBe(400);
		expect(database.prepare('SELECT COUNT(*) AS n FROM travel_requests').get()?.n).toBe(0);
	});
	it('admite una firma temporal mayor que el límite de la firma personal guardada', () => {
		const value = snapshot();
		value.signature = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(2_100_000);
		expect(parseSnapshot(value)).not.toBeNull();
	});
	it('no guarda datos bancarios ni campos ajenos al contrato', () => {
		const value = snapshot();
		Object.assign(value, { account: { number: 'privado' } });
		Object.assign(value.request, { account: 'privado', owner: 'otro' });
		expect(JSON.stringify(parseSnapshot(value))).not.toContain('privado');
		expect(JSON.stringify(parseSnapshot(value))).not.toContain('otro');
	});
	it('limita el tamaño del cuerpo y valida los filtros', async () => {
		const { call } = setup();
		const large = submission();
		large.snapshot.request.concept = 'x'.repeat(8_000_001);
		expect((await call('/api/requests', 'POST', large)).status).toBe(413);
		expect((await call('/api/requests?cursor=invalid')).status).toBe(400);
		expect((await call('/api/requests?status=other')).status).toBe(400);
	});
});

const invoice = (amount = '100.00') => ({
	id: crypto.randomUUID(),
	name: 'factura.png',
	src: 'data:image/png;base64,iVBORw0KGgo=',
	originalSrc: 'data:image/png;base64,iVBORw0KGgo=',
	croppedSrc: '',
	kind: 'invoice',
	date: '2026-10-05',
	series: 'ABC',
	dte: '00123',
	nit: '74807684',
	issuer: 'Proveedor',
	concept: 'Alimentación',
	amount,
	idp: '',
	base: '',
	iva: '',
});
async function accepted(call: ReturnType<typeof setup>['call']) {
	const { item } = await create(call);
	await review(call, item, 'accepted');
	return item;
}
describe('liquidación vinculada a solicitudes aceptadas', () => {
	it('solo permite iniciar una aceptada del propietario y restringe administración a consulta', async () => {
		const { call } = setup();
		const { item } = await create(call);
		const path = `/api/requests/${item.id}/liquidation`;
		const data = { ...initialLiquidation(), receipts: [invoice()] };
		expect((await call(path)).status).toBe(409);
		expect((await call(path, 'PUT', { revision: 0, key: crypto.randomUUID(), status: 'draft', data })).status).toBe(409);
		await review(call, item, 'accepted');
		expect((await call(path)).status).toBe(200);
		expect((await call(path, 'GET', undefined, 'other@tecnasa.com')).status).toBe(404);
		expect((await call(`/api/admin/requests/${item.id}/liquidation`)).status).toBe(403);
		expect((await call(`/api/admin/requests/${item.id}/liquidation`, 'GET', undefined, 'gpac@tecnasa.com')).status).toBe(200);
		expect((await call(`/api/admin/requests/${item.id}/liquidation`, 'PUT', {}, 'gpac@tecnasa.com')).status).toBe(405);
	});
	it('guarda borradores incompletos, restaura datos y páginas, muestra progreso y evita duplicados por reintento', async () => {
		const { call, database } = setup();
		const item = await accepted(call);
		const path = `/api/requests/${item.id}/liquidation`;
		const data = { ...initialLiquidation(), receipts: [{ ...invoice(), series: '', amount: '' }] };
		const mutation = { revision: 0, key: crypto.randomUUID(), status: 'draft', data };
		const response = await call(path, 'PUT', mutation);
		expect(response.status).toBe(200);
		expect(((await response.json()) as LiquidationRecord).revision).toBe(1);
		expect((await call(path, 'PUT', mutation)).status).toBe(200);
		expect(database.prepare('SELECT COUNT(*) AS n FROM liquidation_events').get()?.n).toBe(1);
		const restored = (await (await call(path)).json()) as { liquidation: LiquidationRecord };
		expect(restored.liquidation.data).toEqual(data);
		const list = (await (await call('/api/liquidations')).json()) as {
			requests: SubmittedRequest[];
			progress: Record<string, { status: string }>;
		};
		expect(list.requests.map((r) => r.id)).toEqual([item.id]);
		expect(list.progress[item.id].status).toBe('draft');
		expect(((await (await call('/api/liquidations', 'GET', undefined, 'other@tecnasa.com')).json()) as RequestList).requests).toHaveLength(
			0,
		);
	});
	it('protege contra versiones antiguas y cierra una liquidación finalizada', async () => {
		const { call, database } = setup();
		const item = await accepted(call);
		const path = `/api/requests/${item.id}/liquidation`;
		const data = { ...initialLiquidation(), receipts: [invoice('200.00')] };
		expect((await call(path, 'PUT', { revision: 0, key: crypto.randomUUID(), status: 'draft', data })).status).toBe(200);
		const changed = { ...data, notes: 'Revisión' };
		const results = await Promise.all([
			call(path, 'PUT', { revision: 1, key: crypto.randomUUID(), status: 'draft', data: changed }),
			call(path, 'PUT', { revision: 1, key: crypto.randomUUID(), status: 'draft', data }),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
		const final = { revision: 2, key: crypto.randomUUID(), status: 'submitted', data };
		expect((await call(path, 'PUT', final)).status).toBe(200);
		expect((await call(path, 'PUT', final)).status).toBe(200);
		expect((await call(path, 'PUT', { revision: 3, key: crypto.randomUUID(), status: 'draft', data })).status).toBe(409);
		expect(database.prepare('SELECT COUNT(*) AS n FROM liquidation_events').get()?.n).toBe(3);
		expect(database.prepare('SELECT status FROM travel_requests WHERE id=?').get(item.id)?.status).toBe('accepted');
	});
	it('exige reintegro del saldo, sin sumarlo como gasto y conserva referencias con ceros', async () => {
		const { call } = setup();
		const item = await accepted(call);
		const path = `/api/requests/${item.id}/liquidation`;
		const data = { ...initialLiquidation(), receipts: [invoice()] };
		const send = () => call(path, 'PUT', { revision: 0, key: crypto.randomUUID(), status: 'submitted', data });
		expect((await send()).status).toBe(400);
		data.receipts.push({ ...invoice('38.33'), kind: 'refund', series: '', dte: '0000123', issuer: '', nit: '', date: '2026-10-10' });
		expect((await send()).status).toBe(200);
		const restored = (await (await call(path)).json()) as { liquidation: LiquidationRecord };
		expect(restored.liquidation.data.receipts[1].dte).toBe('0000123');
	});
	it('revierte borrador y auditoría si falla un comprobante, y restaura adjuntos divididos en filas', async () => {
		const fail = setup(),
			item = await accepted(fail.call);
		fail.failWrites();
		expect(
			(
				await fail.call(`/api/requests/${item.id}/liquidation`, 'PUT', {
					revision: 0,
					key: crypto.randomUUID(),
					status: 'draft',
					data: initialLiquidation(),
				})
			).status,
		).toBe(503);
		expect(fail.database.prepare('SELECT COUNT(*) AS n FROM travel_liquidations').get()?.n).toBe(0);
		expect(fail.database.prepare('SELECT COUNT(*) AS n FROM liquidation_events').get()?.n).toBe(0);
		const { call } = setup();
		const largeItem = await accepted(call);
		const src = 'data:image/png;base64,' + 'A'.repeat(600_000);
		const data = { ...initialLiquidation(), notes: 'Observación 🚙', receipts: [{ ...invoice(), src, originalSrc: src }] };
		const path = `/api/requests/${largeItem.id}/liquidation`;
		expect((await call(path, 'PUT', { revision: 0, key: crypto.randomUUID(), status: 'draft', data })).status).toBe(200);
		expect(((await (await call(path)).json()) as { liquidation: LiquidationRecord }).liquidation.data).toEqual(data);
	});
	it('valida series repetidas, fechas fuera del viaje, montos negativos, archivos y origen', async () => {
		const { call } = setup();
		const item = await accepted(call);
		const path = `/api/requests/${item.id}/liquidation`;
		const data = { ...initialLiquidation(), receipts: [invoice()] };
		const send = (value: unknown, origin = 'https://example.com') =>
			call(path, 'PUT', { revision: 0, key: crypto.randomUUID(), status: 'draft', data: value }, 'user@tecnasa.com', origin);
		expect((await send(data, 'https://evil.test')).status).toBe(403);
		for (const patch of [
			{ date: '2026-10-09' },
			{ date: '2026-02-30' },
			{ amount: '-5' },
			{ src: 'https://evil.test/image' },
			{ kind: 'other' },
		])
			expect((await send({ ...data, receipts: [{ ...invoice(), ...patch }] })).status).toBe(400);
		expect((await send({ ...data, receipts: [invoice(), invoice()] })).status).toBe(400);
		expect((await call('/api/liquidations?cursor=invalid')).status).toBe(400);
	});
});
