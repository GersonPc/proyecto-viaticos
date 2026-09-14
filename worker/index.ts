export function handleRequest(request: Request): Response {
	const url = new URL(request.url);

	if (url.pathname === '/api/' || url.pathname === '/api/health') {
		return Response.json(
			{ status: 'ok', message: 'Entorno de desarrollo listo' },
			{ headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
		);
	}

	return new Response(null, { status: 404 });
}

export default {
	fetch(request): Response {
		return handleRequest(request);
	},
} satisfies ExportedHandler<Env>;
