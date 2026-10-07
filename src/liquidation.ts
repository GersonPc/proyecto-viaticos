import { dateStamp, toCents, validDecimal, type RequestData } from './request';
import type { RequestDetail, SubmittedRequest, RequestList } from './workflow';

export const MAX_RECEIPTS = 30;
export type Receipt = {
	id: string;
	name: string;
	src: string;
	originalSrc: string;
	croppedSrc: string;
	kind: 'invoice' | 'refund';
	date: string;
	series: string;
	dte: string;
	nit: string;
	issuer: string;
	concept: string;
	amount: string;
	idp: string;
	base: string;
	iva: string;
};
export type LiquidationData = { schemaVersion: 1; date: string; department: string; notes: string; receipts: Receipt[] };
export type LiquidationRecord = { revision: number; status: 'draft' | 'submitted'; updatedAt: string; data: LiquidationData };
export type LiquidationDetail = RequestDetail & { liquidation: LiquidationRecord | null };
export type LiquidationList = RequestList & { progress: Record<string, { status: 'draft' | 'submitted'; updatedAt: string }> };
export function todayInGuatemala() {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
		new Date(),
	);
}
export const initialLiquidation = (): LiquidationData => ({
	schemaVersion: 1,
	date: todayInGuatemala(),
	department: 'MICROSISTEMAS',
	notes: '',
	receipts: [],
});
export function liquidationTotals(data: LiquidationData, authorizedCents: number) {
	const invoices = data.receipts.filter((r) => r.kind === 'invoice');
	const expenses = invoices.reduce((s, r) => s + toCents(r.amount), 0);
	const refunded = data.receipts.filter((r) => r.kind === 'refund').reduce((s, r) => s + toCents(r.amount), 0);
	const balance = authorizedCents - expenses;
	return {
		expenses,
		refunded,
		balance,
		outstandingRefund: Math.max(0, balance - refunded),
		employeeDue: Math.max(0, -balance),
		idp: invoices.reduce((s, r) => s + toCents(r.idp), 0),
		base: invoices.reduce((s, r) => s + toCents(r.base), 0),
		iva: invoices.reduce((s, r) => s + toCents(r.iva), 0),
	};
}
export function validateLiquidation(
	data: LiquidationData,
	item: Pick<SubmittedRequest, 'totalCents'>,
	request: Pick<RequestData, 'departureDate' | 'returnDate'>,
	complete = false,
) {
	const errors: string[] = [];
	if (!Number.isFinite(dateStamp(data.date))) errors.push('Ingresa una fecha válida para la liquidación.');
	if (!data.department.trim()) errors.push('Ingresa el departamento.');
	if (complete && !data.receipts.some((r) => r.kind === 'invoice')) errors.push('Agrega al menos una factura antes de finalizar.');
	const seen = new Set<string>();
	for (const [i, r] of data.receipts.entries()) {
		const label = `${r.kind === 'refund' ? 'Reintegro' : 'Factura'} ${i + 1}`;
		if (
			r.date &&
			(!Number.isFinite(dateStamp(r.date)) || (r.kind === 'invoice' && (r.date < request.departureDate || r.date > request.returnDate)))
		)
			errors.push(`${label}: revisa la fecha${r.kind === 'invoice' ? ' dentro del viaje' : ''}.`);
		if (r.amount && (!validDecimal(r.amount) || toCents(r.amount) <= 0))
			errors.push(`${label}: ingresa un monto mayor que cero con hasta dos decimales.`);
		for (const key of ['idp', 'base', 'iva'] as const)
			if (r.kind === 'invoice' && r[key] && !validDecimal(r[key])) errors.push(`${label}: revisa el monto de ${key.toUpperCase()}.`);
		if (r.kind === 'invoice' && r.series.trim() && r.dte.trim()) {
			const key = `${r.series.trim().toUpperCase()}|${r.dte.trim().toUpperCase()}`;
			if (seen.has(key)) errors.push(`${label}: la serie y el DTE ya están en otra factura.`);
			seen.add(key);
		}
		if (
			complete &&
			(!r.date || !r.amount || (r.kind === 'invoice' && ![r.series, r.dte, r.nit, r.issuer, r.concept].every((v) => v.trim())))
		)
			errors.push(`${label}: completa ${r.kind === 'invoice' ? 'fecha, serie, DTE, NIT, proveedor, concepto y monto' : 'fecha y monto'}.`);
		if (r.kind === 'invoice' && toCents(r.idp) + toCents(r.iva) > toCents(r.amount) && r.amount)
			errors.push(`${label}: los impuestos no pueden superar el valor de la factura.`);
	}
	const totals = liquidationTotals(data, item.totalCents);
	if (totals.refunded > Math.max(0, totals.balance)) errors.push('El reintegro adjunto supera el saldo a devolver. Revisa los montos.');
	if (complete && totals.outstandingRefund > 0)
		errors.push('Adjunta el comprobante de reintegro por el saldo pendiente antes de finalizar.');
	return errors;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !v.includes('\u0000');
const image = (v: unknown) => text(v, 3_000_000) && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);
export function parseLiquidation(value: unknown): LiquidationData | null {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		!text(value.date, 10) ||
		!text(value.department, 100) ||
		!text(value.notes, 2000) ||
		!Array.isArray(value.receipts) ||
		value.receipts.length > MAX_RECEIPTS
	)
		return null;
	const receipts: Receipt[] = [];
	const ids = new Set<string>();
	for (const r of value.receipts) {
		if (
			!record(r) ||
			!text(r.id, 100) ||
			!r.id ||
			ids.has(r.id) ||
			!text(r.name, 255) ||
			!image(r.src) ||
			!image(r.originalSrc) ||
			!(r.croppedSrc === '' || image(r.croppedSrc)) ||
			(r.src !== r.originalSrc && r.src !== r.croppedSrc) ||
			!['invoice', 'refund'].includes(String(r.kind)) ||
			!['date', 'amount', 'idp', 'base', 'iva'].every((k) => text(r[k], 40)) ||
			!['series', 'dte', 'nit'].every((k) => text(r[k], 100)) ||
			!['issuer', 'concept'].every((k) => text(r[k], 240))
		)
			return null;
		ids.add(r.id);
		receipts.push(
			Object.fromEntries(
				[
					'id',
					'name',
					'src',
					'originalSrc',
					'croppedSrc',
					'kind',
					'date',
					'series',
					'dte',
					'nit',
					'issuer',
					'concept',
					'amount',
					'idp',
					'base',
					'iva',
				].map((k) => [k, r[k]]),
			) as Receipt,
		);
	}
	return { schemaVersion: 1, date: value.date, department: value.department, notes: value.notes, receipts };
}
