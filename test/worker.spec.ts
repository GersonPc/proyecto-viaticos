import { describe, expect, it } from 'vitest';
import { handleRequest } from '../worker';

describe('starter worker', () => {
	it('expone el estado del entorno', async () => {
		const response = handleRequest(new Request('https://example.com/api/health'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok', message: 'Entorno de desarrollo listo' });
	});

	it('responde 404 fuera de la API', () => {
		const response = handleRequest(new Request('https://example.com/no-existe'));
		expect(response.status).toBe(404);
	});
});
