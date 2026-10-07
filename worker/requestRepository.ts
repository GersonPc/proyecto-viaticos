import { requestSummary, type RequestSnapshot, type SubmittedRequest, type RequestStatus, type RequestList } from '../src/workflow';
import { totalsForDates, totalKilometers } from '../src/request';

type RequestRow = {
	id: string;
	owner_email: string;
	status: RequestStatus;
	revision: number;
	submission_key: string;
	snapshot_digest: string;
	name: string;
	request_date: string;
	departure_date: string;
	return_date: string;
	total_cents: number;
	kilometers_hundredths: number;
	summary_json: string;
	submitted_at: string;
	updated_at: string;
	review_reason: string;
};
const mapRow = (row: RequestRow): SubmittedRequest => ({
	id: row.id,
	status: row.status,
	revision: row.revision,
	name: row.name,
	requestDate: row.request_date,
	departureDate: row.departure_date,
	returnDate: row.return_date,
	totalCents: row.total_cents,
	kilometers: row.kilometers_hundredths / 100,
	summary: JSON.parse(row.summary_json),
	submittedAt: row.submitted_at,
	updatedAt: row.updated_at,
	reviewReason: row.review_reason,
});
export type Submission = { id: string; key: string; owner: string; name: string; snapshot: RequestSnapshot; revision?: number };
/** The application depends on this contract; D1 SQL stays inside its adapter. */
export interface RequestRepository {
	role(email: string): Promise<{ admin: boolean; owner: boolean }>;
	list(owner: string | null, status: RequestStatus | null, cursor: string | null, name: string): Promise<RequestList>;
	detail(id: string, owner: string | null): Promise<{ item: SubmittedRequest; snapshot: RequestSnapshot } | null>;
	submit(input: Submission): Promise<SubmittedRequest | null>;
	review(id: string, revision: number, status: 'accepted' | 'rejected', reason: string, actor: string): Promise<SubmittedRequest | null>;
}
export class D1RequestRepository implements RequestRepository {
	constructor(private db: D1Database) {}
	async role(email: string) {
		const row = await this.db
			.prepare('SELECT is_owner FROM request_administrators WHERE email = ?')
			.bind(email)
			.first<{ is_owner: number }>();
		return { admin: !!row, owner: row?.is_owner === 1 };
	}
	async list(owner: string | null, status: RequestStatus | null, cursor: string | null, name: string) {
		const clauses: string[] = [];
		const params: (string | number)[] = [];
		if (owner) {
			clauses.push('owner_email = ?');
			params.push(owner);
		}
		if (status) {
			clauses.push('status = ?');
			params.push(status);
		}
		if (name) {
			clauses.push("name LIKE ? ESCAPE '\\'");
			params.push(`%${name.replace(/[\\%_]/g, '\\$&')}%`);
		}
		if (cursor) {
			const [time, id] = JSON.parse(cursor) as [string, string];
			clauses.push('(submitted_at < ? OR (submitted_at = ? AND id < ?))');
			params.push(time, time, id);
		}
		const { results } = await this.db
			.prepare(
				`SELECT * FROM travel_requests ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY submitted_at DESC, id DESC LIMIT 51`,
			)
			.bind(...params)
			.all<RequestRow>();
		const page = results.slice(0, 50);
		const last = page.at(-1);
		return { requests: page.map(mapRow), nextCursor: results.length > 50 && last ? JSON.stringify([last.submitted_at, last.id]) : null };
	}
	async detail(id: string, owner: string | null) {
		// One SQL read ensures the revision and its chunks cannot disagree during a resubmission.
		const { results } = await this.db
			.prepare(
				`SELECT r.*, c.content FROM travel_requests r JOIN request_snapshot_chunks c ON c.request_id = r.id AND c.revision = r.snapshot_revision WHERE r.id = ? AND (? IS NULL OR r.owner_email = ?) ORDER BY c.chunk_index`,
			)
			.bind(id, owner, owner)
			.all<RequestRow & { content: string }>();
		if (!results.length) return null;
		return { item: mapRow(results[0]), snapshot: JSON.parse(results.map((r) => r.content).join('')) as RequestSnapshot };
	}
	async submit(input: Submission) {
		const { id, key, owner, name, snapshot, revision } = input;
		const now = new Date().toISOString();
		const next = revision ? revision + 1 : 1;
		const r = snapshot.request;
		const payload = JSON.stringify(snapshot);
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
		const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
		const fields = [
			name,
			r.date,
			r.departureDate,
			r.returnDate,
			totalsForDates(r).grandTotal,
			Math.round(totalKilometers(r) * 100),
			JSON.stringify(requestSummary(r)),
		];
		const statement = revision
			? this.db
					.prepare(
						`UPDATE travel_requests SET name=?, request_date=?, departure_date=?, return_date=?, total_cents=?, kilometers_hundredths=?, summary_json=?, status='pending', snapshot_revision=?, revision=?, submission_key=?, snapshot_digest=?, submitted_at=?, updated_at=?, reviewed_by=NULL, review_reason='' WHERE id=? AND owner_email=? AND status='rejected' AND revision=? RETURNING *`,
					)
					.bind(...fields, next, next, key, digest, now, now, id, owner, revision)
			: this.db
					.prepare(
						`INSERT INTO travel_requests(name, request_date, departure_date, return_date, total_cents, kilometers_hundredths, summary_json, status, revision, submission_key, snapshot_digest, created_at, submitted_at, updated_at, id, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`,
					)
					.bind(...fields, key, digest, now, now, now, id, owner);
		const statements = [statement];
		for (let offset = 0, index = 0; offset < payload.length; index++) {
			let end = Math.min(offset + 250_000, payload.length);
			// Do not split a UTF-16 surrogate pair when binding UTF-8 text to SQL.
			const code = payload.charCodeAt(end - 1);
			if (end < payload.length && code >= 0xd800 && code <= 0xdbff) end--;
			statements.push(
				this.db
					.prepare(
						`INSERT INTO request_snapshot_chunks(request_id, revision, chunk_index, content) SELECT id, snapshot_revision, ?, ? FROM travel_requests WHERE id=? AND owner_email=? AND submission_key=? AND snapshot_digest=? AND snapshot_revision=? ON CONFLICT DO NOTHING`,
					)
					.bind(index, payload.slice(offset, end), id, owner, key, digest, next),
			);
			offset = end;
		}
		const results = await this.db.batch<RequestRow>(statements);
		if (results[0].results.length) return mapRow(results[0].results[0]);
		// A retry of an already committed submission returns the same result, without creating another request.
		const existing = await this.db
			.prepare('SELECT * FROM travel_requests WHERE id=? AND owner_email=? AND submission_key=? AND snapshot_digest=?')
			.bind(id, owner, key, digest)
			.first<RequestRow>();
		return existing ? mapRow(existing) : null;
	}
	async review(id: string, revision: number, status: 'accepted' | 'rejected', reason: string, actor: string) {
		const row = await this.db
			.prepare(
				`UPDATE travel_requests SET status=?, reviewed_by=?, review_reason=?, updated_at=?, revision=revision+1 WHERE id=? AND status='pending' AND revision=? AND EXISTS (SELECT 1 FROM request_administrators WHERE email=?) RETURNING *`,
			)
			.bind(status, actor, reason, new Date().toISOString(), id, revision, actor)
			.first<RequestRow>();
		// A decision advances the concurrency version, but snapshots retain their submitted revision.
		return row ? mapRow(row) : null;
	}
}
