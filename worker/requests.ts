import { D1LiquidationRepository } from './liquidationRepository';
import { parseLiquidation, validateLiquidation } from '../src/liquidation';
import { D1RequestRepository } from './requestRepository';
import { parseSnapshot, REQUEST_STATUSES, type RequestStatus } from '../src/workflow';

const MAX_BODY_BYTES = 8_000_000;
const uuid = (v: unknown): v is string =>
	typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
async function body(request: Request): Promise<unknown> {
	if (!request.body) throw new Error('empty');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			throw new RangeError('size');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleWorkflow(request: Request, db: D1Database, email: string): Promise<Response> {
	if (!db) return json({ error: 'El almacenamiento de solicitudes no está disponible.' }, 503);
	const url = new URL(request.url);
	const path = url.pathname;
	const repository = new D1RequestRepository(db);
	try {
		const role = await repository.role(email);
		if (path === '/api/session') {
			if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
			return json({ isAdmin: role.admin, canManageAdmins: role.owner });
		}
		const administrative = path.startsWith('/api/admin/');
		if (administrative && !role.admin) return json({ error: 'No tienes permiso de administrador.' }, 403);
		if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Método no permitido.' }, 405);
		let data: Record<string, unknown> = {};
		if (request.method !== 'GET') {
			if (request.headers.get('Origin') !== url.origin) return json({ error: 'Origen no permitido.' }, 403);
			if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
				return json({ error: 'Envía los datos en formato JSON.' }, 415);
			try {
				const parsed = await body(request);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
				data = parsed as Record<string, unknown>;
			} catch (e) {
				return json(
					{ error: e instanceof RangeError ? 'La solicitud supera 8 MB. Reduce el tamaño de las imágenes.' : 'Los datos no son válidos.' },
					e instanceof RangeError ? 413 : 400,
				);
			}
		}
		if (path === '/api/admin/administrators') {
			if (!role.owner) return json({ error: 'Solo el administrador principal puede gestionar permisos.' }, 403);
			if (request.method === 'GET') {
				const result = await db
					.prepare('SELECT email, is_owner AS isOwner FROM request_administrators ORDER BY is_owner DESC, email')
					.all();
				return json({ administrators: result.results });
			}
			if (!['PUT', 'DELETE'].includes(request.method)) return json({ error: 'Método no permitido.' }, 405);
			const target = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
			if (!/^[^\s@]+@tecnasa\.com$/.test(target) || target.length > 254)
				return json({ error: 'Ingresa un correo @tecnasa.com válido.' }, 400);
			if (target === email) return json({ error: 'El administrador principal conserva su acceso.' }, 409);
			const mutation =
				request.method === 'PUT'
					? db.prepare('INSERT INTO request_administrators(email) VALUES (?) ON CONFLICT DO NOTHING RETURNING email').bind(target)
					: db.prepare('DELETE FROM request_administrators WHERE email=? AND is_owner=0 RETURNING email').bind(target);
			const results = await db.batch([
				mutation,
				db
					.prepare(`INSERT INTO administrator_events(actor_email, target_email, action, occurred_at) SELECT ?, ?, ?, ? WHERE changes() > 0`)
					.bind(email, target, request.method === 'PUT' ? 'granted' : 'revoked', new Date().toISOString()),
			]);
			return json({ changed: results[0].results.length > 0 });
		}
		if (path === '/api/requests' || path === '/api/admin/requests') {
			if (request.method === 'GET') {
				const status = url.searchParams.get('status');
				const cursor = url.searchParams.get('cursor');
				const name = url.searchParams.get('name')?.trim() ?? '';
				if ((status && !REQUEST_STATUSES.includes(status as RequestStatus)) || name.length > 100)
					return json({ error: 'Filtro no válido.' }, 400);
				if (cursor) {
					try {
						const parsed = JSON.parse(cursor);
						if (
							!Array.isArray(parsed) ||
							parsed.length !== 2 ||
							typeof parsed[0] !== 'string' ||
							!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed[0]) ||
							!uuid(parsed[1])
						)
							throw new Error();
					} catch {
						return json({ error: 'Página no válida.' }, 400);
					}
				}
				return json(await repository.list(administrative ? null : email, status as RequestStatus | null, cursor, name));
			}
			if (administrative || request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
			if (!uuid(data.id) || !uuid(data.key)) return json({ error: 'Identificador de envío no válido.' }, 400);
			const snapshot = parseSnapshot(data.snapshot);
			if (!snapshot) return json({ error: 'Revisa las fechas, el objetivo, los gastos y las imágenes antes de enviar.' }, 400);
			const account = await db
				.prepare('SELECT name, account_number FROM employee_accounts WHERE email=?')
				.bind(email)
				.first<{ name: string; account_number: string | null }>();
			if (!account?.name.trim() || !account.account_number) return json({ error: 'Guarda tu cuenta antes de enviar la solicitud.' }, 409);
			const saved = await repository.submit({ id: data.id, key: data.key, owner: email, name: account.name, snapshot });
			return saved ? json(saved, 201) : json({ error: 'El identificador ya corresponde a otra solicitud.' }, 409);
		}

		const liquidationRepository = new D1LiquidationRepository(db);
		if (path === '/api/liquidations') {
			if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
			const cursor = url.searchParams.get('cursor');
			if (cursor) {
				try {
					const parsed = JSON.parse(cursor);
					if (
						!Array.isArray(parsed) ||
						parsed.length !== 2 ||
						typeof parsed[0] !== 'string' ||
						!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed[0]) ||
						!uuid(parsed[1])
					)
						throw new Error();
				} catch {
					return json({ error: 'Página no válida.' }, 400);
				}
			}
			const list = await repository.list(email, 'accepted', cursor, '');
			return json({ ...list, progress: await liquidationRepository.progress(list.requests.map((r) => r.id)) });
		}
		const liquidationMatch = /^\/api\/(admin\/)?requests\/([^/]+)\/liquidation$/.exec(path);
		if (liquidationMatch) {
			const id = liquidationMatch[2];
			if (!uuid(id)) return json({ error: 'Solicitud no encontrada.' }, 404);
			const detail = await repository.detail(id, liquidationMatch[1] ? null : email);
			if (!detail) return json({ error: 'Solicitud no encontrada.' }, 404);
			if (detail.item.status !== 'accepted') return json({ error: 'Solo puedes liquidar solicitudes aceptadas.' }, 409);
			if (request.method === 'GET') return json({ ...detail, liquidation: await liquidationRepository.detail(id) });
			if (liquidationMatch[1] || request.method !== 'PUT') return json({ error: 'Método no permitido.' }, 405);
			if (
				!Number.isSafeInteger(data.revision) ||
				Number(data.revision) < 0 ||
				!uuid(data.key) ||
				!['draft', 'submitted'].includes(String(data.status))
			)
				return json({ error: 'Versión de liquidación no válida.' }, 400);
			const parsed = parseLiquidation(data.data);
			if (!parsed) return json({ error: 'Revisa los datos y los comprobantes de la liquidación.' }, 400);
			const errors = validateLiquidation(parsed, detail.item, detail.snapshot.request, data.status === 'submitted');
			if (errors.length) return json({ error: errors.join(' ') }, 400);
			const saved = await liquidationRepository.save(
				id,
				email,
				Number(data.revision),
				data.key,
				parsed,
				data.status as 'draft' | 'submitted',
			);
			return saved
				? json(saved)
				: json(
						{ error: 'La liquidación cambió en otra pestaña o ya fue finalizada. Vuelve a abrirla para consultar la versión vigente.' },
						409,
					);
		}
		const match = /^\/api\/(admin\/)?requests\/([^/]+)(\/review)?$/.exec(path);
		if (!match || !uuid(match[2])) return json({ error: 'Solicitud no encontrada.' }, 404);
		const id = match[2];
		if (match[1]) {
			if (!match[3]) return json({ error: 'Solicitud no encontrada.' }, 404);
			if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
			if (
				!version(data.revision) ||
				!['accepted', 'rejected'].includes(String(data.status)) ||
				typeof data.reason !== 'string' ||
				data.reason.length > 2000
			)
				return json({ error: 'Decisión no válida.' }, 400);
			const saved = await repository.review(id, data.revision, data.status as 'accepted' | 'rejected', data.reason.trim(), email);
			return saved ? json(saved) : json({ error: 'La solicitud cambió o ya fue revisada. Actualiza la tabla.' }, 409);
		}
		if (match[3]) return json({ error: 'Solicitud no encontrada.' }, 404);
		if (request.method === 'GET') {
			const detail = await repository.detail(id, email);
			return detail ? json(detail) : json({ error: 'Solicitud no encontrada.' }, 404);
		}
		if (request.method !== 'PUT') return json({ error: 'Método no permitido.' }, 405);
		if (!version(data.revision) || !uuid(data.key)) return json({ error: 'Versión de solicitud no válida.' }, 400);
		const snapshot = parseSnapshot(data.snapshot);
		if (!snapshot) return json({ error: 'Revisa las fechas, el objetivo, los gastos y las imágenes antes de reenviar.' }, 400);
		const account = await db.prepare('SELECT name FROM employee_accounts WHERE email=?').bind(email).first<{ name: string }>();
		if (!account) return json({ error: 'No se pudo verificar tu cuenta.' }, 409);
		const saved = await repository.submit({ id, key: data.key, owner: email, name: account.name, snapshot, revision: data.revision });
		return saved
			? json(saved)
			: json({ error: 'Solo puedes reenviar solicitudes rechazadas que no hayan cambiado. Actualiza Mis solicitudes.' }, 409);
	} catch {
		return json({ error: 'No se pudo completar la operación. Intenta de nuevo; si persiste, contacta al administrador.' }, 503);
	}
}
