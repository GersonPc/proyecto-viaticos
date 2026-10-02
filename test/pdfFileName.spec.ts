import { describe, expect, it } from 'vitest';
import { pdfFileName } from '../src/pdfFileName';

describe('PDF file name', () => {
	it('uses only the first Service Ticket and the first client', () => {
		expect(pdfFileName({ serviceTickets: ['123', '456'], projectTickets: ['789'], clients: ['Banco Gte', 'Otro cliente'] })).toBe(
			'Solicitud de viáticos - Ticket 123 - Banco Gte.pdf',
		);
	});

	it('uses the first project ticket when there is no Service Ticket', () => {
		expect(pdfFileName({ serviceTickets: [], projectTickets: ['P-42', 'P-43'], clients: [] })).toBe(
			'Solicitud de viáticos - Ticket P-42.pdf',
		);
	});

	it('keeps a usable name when optional fields are empty and removes forbidden filename characters', () => {
		expect(pdfFileName({ serviceTickets: [], projectTickets: [], clients: [] })).toBe('Solicitud de viáticos.pdf');
		expect(pdfFileName({ serviceTickets: ['  12/34  '], projectTickets: [], clients: ['Banco: Gte.'] })).toBe(
			'Solicitud de viáticos - Ticket 12 34 - Banco Gte.pdf',
		);
	});
});
