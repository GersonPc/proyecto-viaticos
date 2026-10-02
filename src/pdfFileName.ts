import type { RequestData } from './request';

function safeFilePart(value: string): string {
	return value
		.replace(/[<>:"/\\|?*]/g, ' ')
		.replace(/\p{Cc}/gu, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80)
		.replace(/[. ]+$/g, '');
}

function firstValue(values: string[]): string {
	return values.map(safeFilePart).find(Boolean) ?? '';
}

export function pdfFileName(request: Pick<RequestData, 'serviceTickets' | 'projectTickets' | 'clients'>): string {
	const ticket = firstValue(request.serviceTickets) || firstValue(request.projectTickets);
	const client = firstValue(request.clients);
	return ['Solicitud de viáticos', ticket && `Ticket ${ticket}`, client].filter(Boolean).join(' - ') + '.pdf';
}
