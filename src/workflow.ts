import {
	EXTRA_IDS,
	EXPENSE_IDS,
	MEAL_RATES,
	dateStamp,
	totalKilometers,
	totalsForDates,
	validateRequest,
	type RequestData,
} from './request';

export const REQUEST_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada' };
export type RequestSnapshot = { schemaVersion: 1; request: RequestData; signature: string };
export type RequestSummary = {
	concept: string;
	clients: string[];
	destinations: string[];
	serviceTickets: string[];
	projectTickets: string[];
	toolsDetail: string;
	repairsDetail: string;
	extraLabels: RequestData['extraLabels'];
	expenses: ReturnType<typeof totalsForDates>;
};
export type SubmittedRequest = {
	id: string;
	status: RequestStatus;
	revision: number;
	name: string;
	requestDate: string;
	departureDate: string;
	returnDate: string;
	totalCents: number;
	kilometers: number;
	submittedAt: string;
	updatedAt: string;
	reviewReason: string;
	summary: RequestSummary;
};
export type RequestList = { requests: SubmittedRequest[]; nextCursor: string | null };
export type RequestDetail = { item: SubmittedRequest; snapshot: RequestSnapshot };
export function requestSummary(request: RequestData): RequestSummary {
	return {
		concept: request.concept,
		clients: request.clients,
		destinations: request.destinations,
		serviceTickets: request.serviceTickets,
		projectTickets: request.projectTickets,
		toolsDetail: request.toolsDetail,
		repairsDetail: request.repairsDetail,
		extraLabels: request.extraLabels,
		expenses: totalsForDates(request),
	};
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max && !value.includes('\u0000');
const imageSource = (value: unknown) => text(value, 8_000_000) && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
/** Validate untrusted JSON before using the typed calculation model. */
export function parseSnapshot(value: unknown): RequestSnapshot | null {
	if (!record(value) || value.schemaVersion !== 1 || !record(value.request) || !text(value.signature, 8_000_000)) return null;
	if (value.signature && !imageSource(value.signature)) return null;
	const r = value.request;
	if (!['date', 'departureDate', 'returnDate', 'concept', 'toolsDetail', 'repairsDetail'].every((key) => text(r[key]))) return null;
	if (
		!['clients', 'destinations', 'serviceTickets', 'projectTickets'].every(
			(key) => Array.isArray(r[key]) && r[key].length <= 100 && r[key].every((v) => text(v, 240)),
		)
	)
		return null;
	if (!record(r.extraLabels) || !EXTRA_IDS.every((key) => text((r.extraLabels as Record<string, unknown>)[key], 100))) return null;
	if (
		!Array.isArray(r.images) ||
		r.images.length > 30 ||
		!r.images.every(
			(image) =>
				record(image) &&
				text(image.id, 100) &&
				text(image.name, 255) &&
				imageSource(image.src) &&
				['route', 'supplies'].includes(String(image.kind)) &&
				['kilometers', 'price', 'date'].every((key) => text(image[key], 40)),
		)
	)
		return null;
	if (!record(r.meals) || !record(r.expenses)) return null;
	for (const [date, meals] of Object.entries(r.meals)) {
		if (
			!Number.isFinite(dateStamp(date)) ||
			!record(meals) ||
			!Object.entries(meals).every(([key, v]) => Object.hasOwn(MEAL_RATES, key) && typeof v === 'boolean')
		)
			return null;
	}
	for (const [date, expenses] of Object.entries(r.expenses)) {
		if (
			!Number.isFinite(dateStamp(date)) ||
			!record(expenses) ||
			!Object.entries(expenses).every(([key, v]) => EXPENSE_IDS.includes(key as (typeof EXPENSE_IDS)[number]) && text(v, 40))
		)
			return null;
	}
	if (Object.keys(r.meals).length > 732 || Object.keys(r.expenses).length > 732) return null;
	// Strip fields not in the public contract, including any account or identity supplied by a client.
	const request: RequestData = {
		date: r.date as string,
		departureDate: r.departureDate as string,
		returnDate: r.returnDate as string,
		concept: r.concept as string,
		toolsDetail: r.toolsDetail as string,
		repairsDetail: r.repairsDetail as string,
		clients: r.clients as string[],
		destinations: r.destinations as string[],
		serviceTickets: r.serviceTickets as string[],
		projectTickets: r.projectTickets as string[],
		extraLabels: Object.fromEntries(
			EXTRA_IDS.map((key) => [key, (r.extraLabels as Record<string, string>)[key]]),
		) as RequestData['extraLabels'],
		images: r.images.map((i) => ({
			id: i.id,
			name: i.name,
			src: i.src,
			kind: i.kind,
			kilometers: i.kilometers,
			price: i.price,
			date: i.date,
		})),
		meals: r.meals as RequestData['meals'],
		expenses: r.expenses as RequestData['expenses'],
	};
	if (
		validateRequest(request).length ||
		!request.concept.trim() ||
		!Number.isSafeInteger(totalsForDates(request).grandTotal) ||
		!Number.isSafeInteger(Math.round(totalKilometers(request) * 100))
	)
		return null;
	return { schemaVersion: 1, request, signature: value.signature };
}
