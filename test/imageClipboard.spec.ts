import { describe, expect, it } from 'vitest';
import { pastedImageFiles, readClipboardImages } from '../src/imageClipboard';

const png = () => new File(['test image'], 'map.png', { type: 'image/png' });
const data = (items: unknown[], files: File[] = []) => ({ items, files }) as unknown as DataTransfer;
const fileItem = (file: File | null) => ({ kind: 'file', type: 'image/png', getAsFile: () => file });
const clipboard = (items: unknown[]) => ({ read: async () => items }) as Pick<Clipboard, 'read'>;

describe('image clipboard', () => {
	it('extracts image files once when the paste event also provides a file list', () => {
		const image = png();
		expect(pastedImageFiles(data([fileItem(image), { kind: 'string', type: 'text/html' }], [image]))).toEqual([image]);
	});
	it('falls back to files when clipboard items cannot provide them', () => {
		const image = png();
		expect(pastedImageFiles(data([fileItem(null)], [image, new File(['text'], 'text.txt', { type: 'text/plain' })]))).toEqual([image]);
	});
	it('does not treat copied text or HTML as an image', () => {
		expect(
			pastedImageFiles(
				data([
					{ kind: 'string', type: 'text/plain' },
					{ kind: 'string', type: 'text/html' },
				]),
			),
		).toEqual([]);
	});
	it('uses one supported image representation per item and ignores accompanying text', async () => {
		const requested: string[] = [];
		const files = await readClipboardImages(
			clipboard([
				{ types: ['text/plain'] },
				{
					types: ['image/jpeg', 'image/png'],
					getType: async (type: string) => {
						requested.push(type);
						return new Blob(['image'], { type });
					},
				},
				{ types: ['image/webp'], getType: async (type: string) => new Blob(['image2'], { type }) },
			]),
		);
		expect(requested).toEqual(['image/png']);
		expect(files.map((file) => [file.name, file.type])).toEqual([
			['Captura 1.png', 'image/png'],
			['Captura 2.webp', 'image/webp'],
		]);
		expect(await files[0].text()).toBe('image');
	});
	it('provides the paste shortcut when the button is unavailable', async () => {
		await expect(readClipboardImages()).rejects.toThrow('Ctrl+V o ⌘+V');
	});
	it('provides the paste shortcut when clipboard permission is denied', async () => {
		await expect(
			readClipboardImages({
				read: async () => {
					throw new Error('denied');
				},
			}),
		).rejects.toThrow('Ctrl+V o ⌘+V');
	});
	it('reports an empty or text-only clipboard', async () => {
		await expect(readClipboardImages(clipboard([]))).rejects.toThrow('No hay una imagen');
		await expect(readClipboardImages(clipboard([{ types: ['text/plain'] }]))).rejects.toThrow('No hay una imagen');
	});
	it('rejects unsupported image types instead of reading markup', async () => {
		await expect(readClipboardImages(clipboard([{ types: ['image/svg+xml'] }]))).rejects.toThrow('PNG, JPG o WebP');
	});
});
