import { describe, expect, it } from 'vitest';
import {
	initialForm,
	transferValues,
	kilometerCost,
	totalKilometers,
	expenseCents,
	type TravelImage,
	money,
	requestPages,
	totalsForDates,
	travelDays,
	tripDates,
	validateRequest,
	type RequestData,
	type RequestForm,
} from '../src/request';

const route = (kilometers = '107', date = '2026-09-03', id = '1'): TravelImage => ({
	id,
	name: `Mapa ${id}`,
	src: 'data:image/png;base64,test',
	kind: 'route',
	price: '',
	kilometers,
	date,
});

const sample = (changes: Partial<RequestData> = {}): RequestData => ({
	...initialForm.request,
	date: '2026-09-01',
	departureDate: '2026-09-03',
	returnDate: '2026-09-03',
	images: [route()],
	meals: { '2026-09-03': { lunch: true, dinner: true } },
	clients: ['Banco HT', 'Dollar City', 'Garda'],
	expenses: { '2026-09-03': { extra1: '30' } },
	...changes,
});

describe('travel dates', () => {
	it('counts departure and return inclusively, independently of request date', () => {
		expect(travelDays(sample())).toBe(1);
		expect(travelDays(sample({ date: '2025-01-01', returnDate: '2026-09-07' }))).toBe(5);
	});
	it('handles leap days and year boundaries', () => {
		expect(tripDates(sample({ departureDate: '2028-02-28', returnDate: '2028-03-01' }))).toEqual([
			'2028-02-28',
			'2028-02-29',
			'2028-03-01',
		]);
		expect(travelDays(sample({ departureDate: '2026-12-31', returnDate: '2027-01-01' }))).toBe(2);
	});
	it('rejects reversed and invalid date ranges', () => {
		expect(tripDates(sample({ returnDate: '2026-09-02' }))).toEqual([]);
		expect(travelDays(sample({ departureDate: '2026-02-30' }))).toBe(0);
		expect(validateRequest(sample({ returnDate: '' })).length).toBeGreaterThan(0);
	});
	it('aligns Thursday to the reference column and continues long trips without losing dates', () => {
		expect(requestPages(sample())[0][3]).toEqual({ date: '2026-09-03', weekday: 'JUEVES', active: true });
		const request = sample({ returnDate: '2026-09-20' });
		const pages = requestPages(request);
		expect(pages.length).toBe(2);
		expect(
			pages
				.flat()
				.filter((column) => column.active)
				.map((column) => column.date),
		).toEqual(tripDates(request));
		expect(pages.flat().find((column) => column.date === '2026-09-06')?.weekday).toBe('DOMINGO');
	});
});

describe('expense calculations', () => {
	it('reproduces the reference: 107 × 1.30 = 139.10; 75 + 75 + 139.10 + 30 = 319.10', () => {
		const request = sample();
		expect(kilometerCost(request)).toBe(13910);
		const totals = totalsForDates(request);
		expect(totals.byRow.fuel).toBe(13910);
		expect(totals.byDate['2026-09-03']).toBe(31910);
		expect(money(totals.grandTotal)).toBe('319.10');
		expect(validateRequest(request)).toEqual([]);
	});
	it('allocates each image to its day and sums images sharing a day', () => {
		const request = sample({
			departureDate: '2026-09-15',
			returnDate: '2026-09-16',
			images: [route('100', '2026-09-15'), route('80', '2026-09-16', '2')],
		});
		expect(totalKilometers(request)).toBe(180);
		expect(kilometerCost(request)).toBe(23400);
		expect(totalsForDates(request).byDate).toEqual({ '2026-09-15': 13000, '2026-09-16': 10400 });
		const sameDay = { ...request, images: [...request.images, route('20', '2026-09-15', '3')] };
		expect(totalKilometers(sameDay)).toBe(200);
		expect(totalsForDates(sameDay).byDate['2026-09-15']).toBe(15600);
		expect(totalsForDates(sameDay).grandTotal).toBe(26000);
	});
	it('recalculates totals on image edits, date changes, and removal', () => {
		const request = sample({ returnDate: '2026-09-04', images: [route('200', '2026-09-04')] });
		expect(totalsForDates(request).byDate['2026-09-03']).toBe(18000);
		expect(totalsForDates(request).byDate['2026-09-04']).toBe(26000);
		expect(totalsForDates({ ...request, images: [] }).grandTotal).toBe(18000);
		expect(totalKilometers({ ...request, images: [] })).toBe(0);
	});
	it('sums supply images separately from fuel and ignores obsolete manual supply amounts', () => {
		const supplies: TravelImage[] = ['50', '20'].map((price, index) => ({
			...route('100', '2026-09-03', String(index)),
			kind: 'supplies',
			price,
		}));
		const request = sample({ images: supplies, meals: {}, expenses: { '2026-09-03': { extra2: '999' } } });
		expect(totalsForDates(request).byRow.extra2).toBe(7000);
		expect(totalsForDates(request).grandTotal).toBe(7000);
		expect(totalKilometers(request)).toBe(0);
		expect(kilometerCost(request)).toBe(0);
		expect(validateRequest(request)).toEqual([]);
		expect(transferValues({ ...initialForm, request }).amount).toBe('70.00');
		expect(totalsForDates({ ...request, images: supplies.slice(1) }).grandTotal).toBe(2000);
		expect(totalsForDates({ ...request, images: [{ ...supplies[0], price: '50.25' }, supplies[1]] }).grandTotal).toBe(7025);
		const switched = { ...request, images: [{ ...supplies[0], kind: 'route' as const }, supplies[1]] };
		expect(totalsForDates(switched).byRow.extra2).toBe(2000);
		expect(totalsForDates(switched).byRow.fuel).toBe(13000);
		expect(totalKilometers(switched)).toBe(100);
	});
	it('allocates supply prices by date and validates prices independently of kilometers', () => {
		const supply: TravelImage = { ...route('', '2026-09-04'), kind: 'supplies', price: '20.15' };
		const request = sample({ images: [route('10'), supply], meals: {}, expenses: {}, returnDate: '2026-09-04' });
		expect(totalsForDates(request).byDate).toEqual({ '2026-09-03': 1300, '2026-09-04': 2015 });
		expect(validateRequest(request)).toEqual([]);
		for (const price of ['', '-1', '1.234', 'NaN']) {
			expect(validateRequest({ ...request, images: [{ ...supply, price }] }).some((error) => error.includes('precio válido'))).toBe(true);
		}
		expect(totalsForDates({ ...request, returnDate: '2026-09-03' }).grandTotal).toBe(1300);
		expect(validateRequest({ ...request, returnDate: '2026-09-03' })).toContain('Imagen 2: selecciona una fecha dentro del viaje.');
	});
	it('uses fixed meal rates per day and zero for No', () => {
		const request = sample({
			returnDate: '2026-09-04',
			images: [],
			expenses: {},
			meals: { '2026-09-03': { breakfast: true, lunch: true, dinner: true }, '2026-09-04': { breakfast: false, lunch: true } },
		});
		expect(expenseCents(request, '2026-09-03', 'breakfast')).toBe(5000);
		expect(expenseCents(request, '2026-09-03', 'lunch')).toBe(7500);
		expect(expenseCents(request, '2026-09-03', 'dinner')).toBe(7500);
		expect(totalsForDates(request).byDate).toEqual({ '2026-09-03': 20000, '2026-09-04': 7500 });
		expect(totalsForDates({ ...request, meals: {} }).grandTotal).toBe(0);
	});
	it('rounds each image to cents so displayed image, daily and trip costs reconcile', () => {
		const request = sample({
			images: [route('0.05'), route('0.05', '2026-09-03', '2')],
			meals: {},
			expenses: { '2026-09-03': { extra1: '0.10', lodging: '0.20' } },
		});
		expect(totalKilometers(request)).toBe(0.1);
		expect(kilometerCost(request)).toBe(14);
		expect(totalsForDates(request).grandTotal).toBe(44);
	});
	it('requires image kilometers and a date inside the trip, allowing zero for quotations', () => {
		for (const kilometers of ['', '-1', 'NaN', '1.234'])
			expect(validateRequest(sample({ images: [route(kilometers)] })).some((error) => error.includes('Imagen 1'))).toBe(true);
		for (const date of ['', '2026-02-30', '2026-09-04'])
			expect(validateRequest(sample({ images: [route('100', date)] })).some((error) => error.includes('fecha dentro del viaje'))).toBe(
				true,
			);
		expect(validateRequest(sample({ images: [route('0')] }))).toEqual([]);
	});
	it('excludes expenses outside the selected travel dates', () => {
		expect(totalsForDates(sample({ departureDate: '2026-09-04', returnDate: '2026-09-04' })).grandTotal).toBe(0);
	});
	it('requires a label for an extra amount and rejects negative or imprecise amounts', () => {
		const unnamed = sample({ expenses: { '2026-09-03': { extra3: '20' } } });
		expect(validateRequest(unnamed)).toContain('Asigna un nombre a cada gasto extra que tenga un monto.');
		for (const value of ['-1', '2.555', 'NaN']) {
			expect(validateRequest(sample({ expenses: { '2026-09-03': { lodging: value } } })).length).toBeGreaterThan(0);
		}
	});
	it('uses the same name, date and calculated total in Transferencia', () => {
		const form: RequestForm = {
			...initialForm,
			person: { name: 'María López', signature: 'data:image/png;base64,test' },
			request: sample(),
		};
		const values = transferValues(form);
		expect([values.beneficiary, values.accountHolder, values.requestedBy, values.preparedBy]).toEqual(Array(4).fill('María López'));
		expect(values.signature).toBe(form.person.signature);
		expect(values.amount).toBe('319.10');
		expect(values.date).toBe('martes, 1 de septiembre de 2026');
		expect(transferValues({ ...form, request: { ...form.request, images: [route('200')] } }).amount).toBe('440.00');
	});
	it('keeps service tickets, project tickets and destinations independent', () => {
		const request = sample({
			serviceTickets: ['001', '002'],
			projectTickets: ['3497332', '3497333'],
			destinations: ['Banco G&T Continental', 'Dollar City'],
		});
		expect(request.serviceTickets.join(', ')).toBe('001, 002');
		expect(request.projectTickets.join(', ')).toBe('3497332, 3497333');
		expect(request.destinations).toHaveLength(2);
	});
});
