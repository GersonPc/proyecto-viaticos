export const attachmentImageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export class ImageAttachmentError extends Error {}

export function pastedImageFiles(data: Pick<DataTransfer, 'items' | 'files'>): File[] {
	const items = Array.from(data.items);
	const files = items
		.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
	return files.length ? files : Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

export async function readClipboardImages(clipboard?: Pick<Clipboard, 'read'>): Promise<File[]> {
	if (!clipboard?.read) {
		throw new ImageAttachmentError(
			'Este navegador no permite usar el botón. Pega la captura en la zona con Ctrl+V o ⌘+V, o elige un archivo.',
		);
	}
	let items: ClipboardItems;
	try {
		items = await clipboard.read();
	} catch {
		throw new ImageAttachmentError('No se pudo leer el portapapeles. Pega la captura en la zona con Ctrl+V o ⌘+V, o elige un archivo.');
	}
	const files: File[] = [];
	for (const item of items) {
		const type = attachmentImageTypes.find((type) => item.types.includes(type));
		if (!type) {
			if (item.types.some((type) => type.startsWith('image/'))) {
				throw new ImageAttachmentError('Los mapas y cotizaciones deben ser PNG, JPG o WebP.');
			}
			continue;
		}
		const blob = await item.getType(type);
		const extension = type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
		files.push(new File([blob], `Captura ${files.length + 1}.${extension}`, { type }));
	}
	if (!files.length) throw new ImageAttachmentError('No hay una imagen en el portapapeles. Copia una captura del mapa y vuelve a pegarla.');
	return files;
}
