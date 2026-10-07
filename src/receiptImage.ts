/** Only trims near-white margins. Never forces a portrait crop through receipt text. */
export function receiptBounds(pixels: Uint8ClampedArray, width: number, height: number) {
	let left = width,
		top = height,
		right = -1,
		bottom = -1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (pixels[i + 3] > 40 && (pixels[i] < 238 || pixels[i + 1] < 238 || pixels[i + 2] < 238)) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	if (right < left || bottom < top) return { x: 0, y: 0, width, height };
	const pad = Math.max(4, Math.round(Math.max(width, height) * 0.015));
	left = Math.max(0, left - pad);
	top = Math.max(0, top - pad);
	right = Math.min(width - 1, right + pad);
	bottom = Math.min(height - 1, bottom + pad);
	return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
const asDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
		reader.readAsDataURL(blob);
	});
export async function prepareReceiptImage(file: File) {
	if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Usa comprobantes PNG, JPG o WebP.');
	if (file.size > 10 * 1024 * 1024) throw new Error('Cada comprobante puede tener hasta 10 MB antes de optimizarlo.');
	const image = new Image();
	image.src = await asDataUrl(file);
	await image.decode();
	if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50_000_000)
		throw new Error('La imagen es demasiado grande. Reduce su resolución.');
	const canvas = document.createElement('canvas');
	const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
	canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
	canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('No se pudo procesar la imagen.');
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	const originalSrc = canvas.toDataURL('image/jpeg', 0.88);
	const bounds = receiptBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
	const trimmed = document.createElement('canvas');
	trimmed.width = bounds.width;
	trimmed.height = bounds.height;
	const crop = trimmed.getContext('2d');
	if (!crop) throw new Error('No se pudo recortar el comprobante.');
	crop.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
	const croppedSrc =
		bounds.width < canvas.width * 0.97 || bounds.height < canvas.height * 0.97 ? trimmed.toDataURL('image/jpeg', 0.88) : '';
	return { originalSrc, croppedSrc, src: croppedSrc || originalSrc };
}

async function decodedCanvas(src: string) {
	const image = new Image();
	image.src = src;
	await image.decode();
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('No se pudo ajustar la imagen.');
	return { image, canvas, context };
}
export async function cropReceipt(src: string, edges: { left: number; right: number; top: number; bottom: number }) {
	const { image, canvas, context } = await decodedCanvas(src);
	const x = Math.round((image.naturalWidth * edges.left) / 100),
		y = Math.round((image.naturalHeight * edges.top) / 100);
	const width = Math.max(1, Math.round((image.naturalWidth * (100 - edges.left - edges.right)) / 100));
	const height = Math.max(1, Math.round((image.naturalHeight * (100 - edges.top - edges.bottom)) / 100));
	canvas.width = width;
	canvas.height = height;
	context.drawImage(image, x, y, width, height, 0, 0, width, height);
	const croppedSrc = canvas.toDataURL('image/jpeg', 0.9);
	return { croppedSrc, src: croppedSrc };
}
export async function rotateReceipt(src: string) {
	const { image, canvas, context } = await decodedCanvas(src);
	canvas.width = image.naturalHeight;
	canvas.height = image.naturalWidth;
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate(Math.PI / 2);
	context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
	return canvas.toDataURL('image/jpeg', 0.9);
}
