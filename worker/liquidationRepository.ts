import type { LiquidationData, LiquidationRecord } from '../src/liquidation';
type Row = { request_id: string; revision: number; status: 'draft' | 'submitted'; updated_at: string };
export class D1LiquidationRepository {
	constructor(private db: D1Database) {}
	async detail(id: string): Promise<LiquidationRecord | null> {
		const { results } = await this.db
			.prepare(
				`SELECT l.*, c.content FROM travel_liquidations l JOIN liquidation_chunks c ON c.request_id=l.request_id AND c.revision=l.revision WHERE l.request_id=? ORDER BY c.chunk_index`,
			)
			.bind(id)
			.all<Row & { content: string }>();
		if (!results.length) return null;
		return {
			revision: results[0].revision,
			status: results[0].status,
			updatedAt: results[0].updated_at,
			data: JSON.parse(results.map((r) => r.content).join('')),
		};
	}
	async progress(ids: string[]) {
		if (!ids.length) return {};
		const { results } = await this.db
			.prepare(`SELECT request_id, status, updated_at FROM travel_liquidations WHERE request_id IN (${ids.map(() => '?').join(',')})`)
			.bind(...ids)
			.all<Row>();
		return Object.fromEntries(results.map((r) => [r.request_id, { status: r.status, updatedAt: r.updated_at }]));
	}
	async save(
		id: string,
		owner: string,
		revision: number,
		key: string,
		data: LiquidationData,
		status: 'draft' | 'submitted',
	): Promise<LiquidationRecord | null> {
		const payload = JSON.stringify(data);
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${status}:${payload}`));
		const digest = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
		const next = revision + 1,
			now = new Date().toISOString();
		const mutation =
			revision === 0
				? this.db
						.prepare(
							`INSERT INTO travel_liquidations(request_id,revision,status,operation_key,digest,updated_at) SELECT id,1,?,?,?,? FROM travel_requests WHERE id=? AND owner_email=? AND status='accepted' ON CONFLICT DO NOTHING RETURNING *`,
						)
						.bind(status, key, digest, now, id, owner)
				: this.db
						.prepare(
							`UPDATE travel_liquidations SET revision=?,status=?,operation_key=?,digest=?,updated_at=? WHERE request_id=? AND revision=? AND status='draft' AND EXISTS(SELECT 1 FROM travel_requests WHERE id=? AND owner_email=? AND status='accepted') RETURNING *`,
						)
						.bind(next, status, key, digest, now, id, revision, id, owner);
		const statements = [mutation];
		for (let offset = 0, index = 0; offset < payload.length; index++) {
			let end = Math.min(offset + 250_000, payload.length);
			const code = payload.charCodeAt(end - 1);
			if (end < payload.length && code >= 0xd800 && code <= 0xdbff) end--;
			statements.push(
				this.db
					.prepare(
						`INSERT INTO liquidation_chunks(request_id,revision,chunk_index,content) SELECT request_id,revision,?,? FROM travel_liquidations WHERE request_id=? AND revision=? AND operation_key=? AND digest=? ON CONFLICT DO NOTHING`,
					)
					.bind(index, payload.slice(offset, end), id, next, key, digest),
			);
			offset = end;
		}
		const results = await this.db.batch(statements);
		if (!results[0].results.length) {
			const retried = await this.db
				.prepare('SELECT request_id FROM travel_liquidations WHERE request_id=? AND operation_key=? AND digest=?')
				.bind(id, key, digest)
				.first();
			if (!retried) return null;
		}
		return this.detail(id);
	}
}
