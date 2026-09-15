export const FIXED_EXPENSES = [
	{ id: 'breakfast', label: 'Desayuno' },
	{ id: 'lunch', label: 'Almuerzo' },
	{ id: 'dinner', label: 'Cena' },
	{ id: 'lodging', label: 'Hospedaje' },
	{ id: 'fuel', label: 'Combustible' },
] as const;
export const EXTRA_IDS = ['extra1', 'extra2', 'extra3', 'extra4'] as const;
export type ExpenseId = (typeof FIXED_EXPENSES)[number]['id'] | (typeof EXTRA_IDS)[number];
export const EXPENSE_IDS: ExpenseId[] = [...FIXED_EXPENSES.map((row) => row.id), ...EXTRA_IDS];
export const MEAL_RATES = { breakfast: 5000, lunch: 7500, dinner: 7500 } as const;
export type MealId = keyof typeof MEAL_RATES;
export function isMeal(id: ExpenseId): id is MealId {
	return id === 'breakfast' || id === 'lunch' || id === 'dinner';
}
export type TravelImage = { id: string; name: string; src: string; kilometers: string; date: string };
export const KM_RATE_CENTS = 130;
export const COLUMNS_PER_PAGE = 12;
export const MAX_TRAVEL_DAYS = 366;

export type RequestData = {
	date: string;
	departureDate: string;
	returnDate: string;
	concept: string;
	objective: string;
	destinations: string[];
	serviceTickets: string[];
	projectTickets: string[];
	images: TravelImage[];
	meals: Record<string, Partial<Record<MealId, boolean>>>;
	extraLabels: Record<(typeof EXTRA_IDS)[number], string>;
	expenses: Record<string, Partial<Record<ExpenseId, string>>>;
	toolsDetail: string;
	repairsDetail: string;
};
/** Shared identity and request data; totals are derived, never stored twice. */
export type RequestForm = {
	person: { name: string; signature: string };
	account: { number: string; type: string; bank: string };
	request: RequestData;
};
export const initialForm: RequestForm = {
	person: { name: '', signature: '' },
	account: { number: '', type: 'Ahorros', bank: 'Banco Industrial' },
	request: {
		date: '',
		departureDate: '',
		returnDate: '',
		concept: '',
		objective: '',
		destinations: [],
		serviceTickets: [],
		projectTickets: [],
		images: [],
		meals: {},
		extraLabels: { extra1: 'Parqueo', extra2: 'Insumos', extra3: '', extra4: '' },
		expenses: {},
		toolsDetail: '',
		repairsDetail: '',
	},
};
const DAY_MS = 86_400_000;
export function dateStamp(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : NaN;
}
export function travelDays(request: RequestData) {
	const start = dateStamp(request.departureDate);
	const end = dateStamp(request.returnDate);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
	return (end - start) / DAY_MS + 1;
}
export function tripDates(request: RequestData) {
	const days = travelDays(request);
	if (!days || days > MAX_TRAVEL_DAYS) return [];
	const start = dateStamp(request.departureDate);
	return Array.from({ length: days }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}
export function formatDate(value: string, long = false) {
	const stamp = dateStamp(value);
	if (!Number.isFinite(stamp)) return '';
	return new Intl.DateTimeFormat('es-GT', {
		timeZone: 'UTC',
		...(long
			? ({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const)
			: ({ day: '2-digit', month: '2-digit', year: 'numeric' } as const)),
	}).format(new Date(stamp));
}
export function shortDate(value: string) {
	const date = new Date(dateStamp(value));
	const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	return `${String(date.getUTCDate()).padStart(2, '0')}-${months[date.getUTCMonth()]}-${String(date.getUTCFullYear()).slice(-2)}`;
}
/** Decimal input is converted to integer hundredths before any addition. */
export function validDecimal(value: string) {
	return /^(?:\d{1,9})(?:\.\d{1,2})?$/.test(value) && Number(value) >= 0;
}
export function toCents(value: string) {
	if (!validDecimal(value)) return 0;
	const [whole, fraction = ''] = value.split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function money(cents: number) {
	return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
export function imageFuelCost(image: TravelImage) {
	return Math.round((toCents(image.kilometers) * KM_RATE_CENTS) / 100);
}
export function totalKilometers(request: RequestData) {
	return request.images.reduce((sum, image) => sum + toCents(image.kilometers), 0) / 100;
}
export function kilometerCost(request: RequestData) {
	return request.images.reduce((sum, image) => sum + imageFuelCost(image), 0);
}
export function expenseCents(request: RequestData, date: string, id: ExpenseId) {
	if (isMeal(id)) return request.meals[date]?.[id] ? MEAL_RATES[id] : 0;
	if (id === 'fuel') return request.images.filter((image) => image.date === date).reduce((sum, image) => sum + imageFuelCost(image), 0);
	return toCents(request.expenses[date]?.[id] ?? '');
}
export function expenseRows(request: RequestData) {
	return [...FIXED_EXPENSES, ...EXTRA_IDS.map((id) => ({ id, label: request.extraLabels[id] }))];
}
export function totalsForDates(request: RequestData, dates = tripDates(request)) {
	const byRow = Object.fromEntries(EXPENSE_IDS.map((id) => [id, 0])) as Record<ExpenseId, number>;
	const byDate: Record<string, number> = {};
	for (const date of dates) {
		byDate[date] = 0;
		for (const id of EXPENSE_IDS) {
			const value = expenseCents(request, date, id);
			byRow[id] += value;
			byDate[date] += value;
		}
	}
	return { byRow, byDate, grandTotal: Object.values(byRow).reduce((sum, value) => sum + value, 0) };
}
export type DayColumn = { date: string; weekday: string; active: boolean };
/** Keep the reference's Monday start; continue in 12-column sheets if needed. */
export function requestPages(request: RequestData): DayColumn[][] {
	const dates = tripDates(request);
	const start = dates.length ? dateStamp(dates[0]) : dateStamp('2026-09-07');
	const offset = (new Date(start).getUTCDay() + 6) % 7;
	const first = start - offset * DAY_MS;
	const count = Math.max(1, Math.ceil((dates.length + offset) / COLUMNS_PER_PAGE));
	const active = new Set(dates);
	const weekdays = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
	return Array.from({ length: count }, (_, page) =>
		Array.from({ length: COLUMNS_PER_PAGE }, (_, column) => {
			const date = new Date(first + (page * COLUMNS_PER_PAGE + column) * DAY_MS);
			const iso = date.toISOString().slice(0, 10);
			return { date: iso, weekday: weekdays[date.getUTCDay()], active: active.has(iso) };
		}),
	);
}
export function validateRequest(request: RequestData) {
	const errors: string[] = [];
	if (!formatDate(request.date)) errors.push('Ingresa una fecha de solicitud válida.');
	if (!travelDays(request)) errors.push('Revisa las fechas de salida y regreso: el regreso no puede ser anterior a la salida.');
	if (travelDays(request) > MAX_TRAVEL_DAYS) errors.push(`El viaje puede abarcar hasta ${MAX_TRAVEL_DAYS} días.`);
	if (!request.objective.trim()) errors.push('Ingresa el detalle del objetivo / nombre completo del ticket.');

	const dates = tripDates(request);
	for (const [index, image] of request.images.entries()) {
		if (!validDecimal(image.kilometers))
			errors.push(`Imagen ${index + 1}: ingresa kilómetros válidos (0 si no hay recorrido), con hasta dos decimales.`);
		if (!dates.includes(image.date)) errors.push(`Imagen ${index + 1}: selecciona una fecha dentro del viaje.`);
	}
	for (const row of expenseRows(request)) {
		const manualValues = dates.map((date) => request.expenses[date]?.[row.id] ?? '');
		if (row.id !== 'fuel' && !isMeal(row.id) && manualValues.some((value) => value !== '' && !validDecimal(value))) {
			errors.push(`Revisa ${row.label || 'el gasto extra'}: usa montos positivos con hasta dos decimales.`);
		}
		if (!row.label.trim() && manualValues.some((value) => toCents(value) > 0))
			errors.push('Asigna un nombre a cada gasto extra que tenga un monto.');
	}
	if (totalsForDates(request).grandTotal <= 0) errors.push('Ingresa al menos un gasto para calcular el monto solicitado.');
	return errors;
}
export function transferValues(form: RequestForm) {
	const total = totalsForDates(form.request).grandTotal;
	return {
		beneficiary: form.person.name,
		accountHolder: form.person.name,
		requestedBy: form.person.name,
		preparedBy: form.person.name,
		signature: form.person.signature,
		date: formatDate(form.request.date, true),
		amount: total > 0 ? money(total) : '',
		concept: form.request.concept,
		objective: form.request.objective,
	};
}
