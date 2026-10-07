import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiquidationPages } from '../src/LiquidationPages';
import { initialForm } from '../src/request';
import { initialLiquidation, type Receipt } from '../src/liquidation';
import { requestSummary, type RequestDetail } from '../src/workflow';
const request = { ...initialForm.request, date: '2026-10-05', departureDate: '2026-10-05', returnDate: '2026-10-06', concept: 'Prueba' };
const detail: RequestDetail = {
	item: {
		id: 'test',
		status: 'accepted',
		revision: 2,
		name: 'Persona de prueba',
		requestDate: request.date,
		departureDate: request.departureDate,
		returnDate: request.returnDate,
		totalCents: 30000,
		kilometers: 0,
		submittedAt: '2026-10-05T00:00:00Z',
		updatedAt: '2026-10-05T00:00:00Z',
		reviewReason: '',
		summary: requestSummary(request),
	},
	snapshot: { schemaVersion: 1, request, signature: '' },
};
const receipt = (i: number): Receipt => ({
	id: String(i),
	name: `Factura ${i}`,
	src: 'data:image/png;base64,AAAA',
	originalSrc: 'data:image/png;base64,AAAA',
	croppedSrc: '',
	kind: 'invoice',
	date: '2026-10-05',
	series: 'ABC',
	dte: `000${i}`,
	nit: '123',
	issuer: 'Proveedor',
	concept: 'Alimentación',
	amount: '10',
	idp: '',
	base: '',
	iva: '',
});
describe('páginas del PDF de liquidación', () => {
	it('distribuye comprobantes verticales de dos en dos, deja el último espacio vacío y separa el reintegro de la tabla', () => {
		const data = { ...initialLiquidation(), receipts: [receipt(1), receipt(2), { ...receipt(3), kind: 'refund' as const, amount: '280' }] };
		const html = renderToStaticMarkup(createElement(LiquidationPages, { detail, data }));
		const pages = html.split('</section>').filter((s) => s.includes('<section'));
		expect(pages).toHaveLength(3);
		expect(pages[0]).toContain('viewBox="0 0 792 612"');
		expect(pages[0]).not.toContain('0003');
		expect(pages[0]).toContain('20.00');
		expect(pages[0]).not.toContain('Reintegro adjunto');
		expect(pages[1]).toContain('viewBox="0 0 612 792"');
		expect(pages[1].match(/<image /g)).toHaveLength(2);
		expect(pages[2].match(/<image /g)).toHaveLength(1);
		for (const page of pages.slice(1)) {
			expect(page).not.toContain('<text');
			expect(page).not.toContain('<line');
			expect(page).not.toContain('stroke=');
		}
		expect(pages[1].match(/preserveAspectRatio="xMidYMid meet"/g)).toHaveLength(2);
	});
	it('continúa la tabla cuando hay más de quince facturas sin perder comprobantes', () => {
		const data = { ...initialLiquidation(), receipts: Array.from({ length: 16 }, (_, i) => receipt(i + 1)) };
		const pages = renderToStaticMarkup(createElement(LiquidationPages, { detail, data }))
			.split('</section>')
			.filter((s) => s.includes('<section'));
		expect(pages).toHaveLength(10);
		expect(pages[1]).toContain('2 / 2');
		expect(pages[1]).toContain('00016');
		expect(pages.slice(2).flatMap((s) => s.match(/<image /g) ?? [])).toHaveLength(16);
	});
});
