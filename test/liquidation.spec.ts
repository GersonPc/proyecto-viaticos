import { describe, it, expect } from 'vitest';
import { initialLiquidation, liquidationTotals, parseLiquidation, validateLiquidation, type Receipt } from '../src/liquidation';
import { receiptBounds } from '../src/receiptImage';
const receipt = (patch: Partial<Receipt> = {}): Receipt => ({
	id: '1',
	name: 'Factura',
	src: 'data:image/png;base64,AAAA',
	originalSrc: 'data:image/png;base64,AAAA',
	croppedSrc: '',
	kind: 'invoice',
	date: '2026-10-05',
	series: 'ABC',
	dte: '000123',
	nit: '123',
	issuer: 'Proveedor',
	concept: 'Alimentación',
	amount: '0.10',
	idp: '',
	base: '',
	iva: '',
	...patch,
});
const request = { departureDate: '2026-10-05', returnDate: '2026-10-06' };
describe('cálculos y validación de liquidación', () => {
	it('suma centavos exactos y separa reintegros, impuestos y saldo del colaborador', () => {
		const data = {
			...initialLiquidation(),
			receipts: [
				receipt({ amount: '0.10', iva: '0.01' }),
				receipt({ id: '2', amount: '0.20', dte: '124' }),
				receipt({ id: '3', kind: 'refund', amount: '0.70' }),
			],
		};
		expect(liquidationTotals(data, 100)).toMatchObject({
			expenses: 30,
			refunded: 70,
			balance: 70,
			outstandingRefund: 0,
			employeeDue: 0,
			iva: 1,
		});
		expect(liquidationTotals({ ...data, receipts: data.receipts.slice(0, 2) }, 20)).toMatchObject({
			balance: -10,
			employeeDue: 10,
			outstandingRefund: 0,
		});
	});
	it('permite un borrador incompleto pero exige los datos para finalizar', () => {
		const data = { ...initialLiquidation(), receipts: [receipt({ series: '', amount: '' })] };
		expect(validateLiquidation(data, { totalCents: 100 }, request)).toEqual([]);
		expect(validateLiquidation(data, { totalCents: 100 }, request, true).length).toBeGreaterThan(0);
	});
	it('ignora campos de identidad, conserva DTE como texto y rechaza datos no contratados', () => {
		const data = { ...initialLiquidation(), owner: 'falso', receipts: [receipt()] };
		expect(parseLiquidation(data)?.receipts[0].dte).toBe('000123');
		expect(parseLiquidation(data)).not.toHaveProperty('owner');
		expect(parseLiquidation({ ...data, receipts: [receipt(), receipt()] })).toBeNull();
		expect(parseLiquidation({ ...data, receipts: [receipt({ src: 'data:image/svg+xml;base64,AAAA' })] })).toBeNull();
	});
});
describe('recorte conservador de comprobantes', () => {
	it('quita margen blanco manteniendo el contenido y un margen protector', () => {
		const width = 100,
			height = 100,
			pixels = new Uint8ClampedArray(width * height * 4).fill(255);
		for (let y = 10; y < 90; y++)
			for (let x = 30; x < 70; x++) {
				const i = (y * width + x) * 4;
				pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
			}
		const bounds = receiptBounds(pixels, width, height);
		expect(bounds).toEqual({ x: 26, y: 6, width: 48, height: 88 });
	});
	it('conserva la imagen completa con contenido hasta los bordes o sin contenido detectable', () => {
		const white = new Uint8ClampedArray(100 * 100 * 4).fill(255);
		expect(receiptBounds(white, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
		const black = new Uint8ClampedArray(100 * 100 * 4);
		for (let i = 3; i < black.length; i += 4) black[i] = 255;
		expect(receiptBounds(black, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
	});
});
