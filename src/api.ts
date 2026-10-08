export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
	const data = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación. Intenta de nuevo.');
	return data as T;
}
export const jsonOptions = (method: string, data: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(data),
});
