const LETTER_PORTRAIT = { width: 612, height: 792 };
const LETTER_LANDSCAPE = { width: 792, height: 612 };
const PIXELS_PER_POINT = 3;

function pageCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = width * PIXELS_PER_POINT;
	canvas.height = height * PIXELS_PER_POINT;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Este navegador no pudo crear las páginas del PDF.');
	context.scale(PIXELS_PER_POINT, PIXELS_PER_POINT);
	context.fillStyle = '#fff';
	context.fillRect(0, 0, width, height);
	return { canvas, context };
}

async function loadImage(src: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = src;
	await image.decode();
	return image;
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
	if (!blob) throw new Error('No se pudo convertir una página a imagen.');
	return blob.arrayBuffer();
}

async function drawSvgPage(section: HTMLElement, size: { width: number; height: number }, template: string): Promise<ArrayBuffer> {
	const source = section.querySelector('svg');
	if (!source) throw new Error('Falta una página en la vista previa.');
	const { canvas, context } = pageCanvas(size.width, size.height);
	const background = await loadImage(template);
	context.drawImage(background, 0, 0, size.width, size.height);

	const overlay = source.cloneNode(true) as SVGSVGElement;
	overlay.querySelector(`image[href="${template}"]`)?.remove();
	overlay.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	overlay.setAttribute('width', String(size.width));
	overlay.setAttribute('height', String(size.height));
	const svgBlob = new Blob([new XMLSerializer().serializeToString(overlay)], { type: 'image/svg+xml;charset=utf-8' });
	const svgUrl = URL.createObjectURL(svgBlob);
	try {
		const content = await loadImage(svgUrl);
		context.drawImage(content, 0, 0, size.width, size.height);
	} finally {
		URL.revokeObjectURL(svgUrl);
	}
	return canvasJpeg(canvas);
}

async function drawMapPage(section: HTMLElement): Promise<ArrayBuffer> {
	const { width, height } = LETTER_PORTRAIT;
	const { canvas, context } = pageCanvas(width, height);
	const images = Array.from(section.querySelectorAll<HTMLImageElement>('figure img'));
	const marginX = 0.65 * 72;
	const marginY = 0.6 * 72;
	const gap = 0.012 * width;
	const slotWidth = width - marginX * 2;
	const slotHeight = (height - marginY * 2 - gap * (images.length - 1)) / images.length;
	for (const [index, element] of images.entries()) {
		const image = await loadImage(element.src);
		const scale = Math.min(slotWidth / image.naturalWidth, slotHeight / image.naturalHeight);
		const imageWidth = image.naturalWidth * scale;
		const imageHeight = image.naturalHeight * scale;
		const x = marginX + (slotWidth - imageWidth) / 2;
		const y = marginY + index * (slotHeight + gap) + (slotHeight - imageHeight) / 2;
		context.drawImage(image, x, y, imageWidth, imageHeight);
	}
	return canvasJpeg(canvas);
}

export async function createRequestPdf(printArea: HTMLElement): Promise<Blob> {
	await document.fonts.ready;
	const { PDFDocument } = await import('pdf-lib');
	const pdf = await PDFDocument.create();
	pdf.setTitle('Solicitud de viáticos');
	const sections = Array.from(printArea.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
	if (!sections.length) throw new Error('No hay páginas para generar el PDF.');
	for (const section of sections) {
		const landscape = section.classList.contains('request-sheet');
		const size = landscape ? LETTER_LANDSCAPE : LETTER_PORTRAIT;
		const jpeg = section.classList.contains('transfer-sheet')
			? await drawSvgPage(section, size, '/transfer-template.svg')
			: landscape
				? await drawSvgPage(section, size, '/request-template.svg')
				: await drawMapPage(section);
		const embedded = await pdf.embedJpg(jpeg);
		pdf.addPage([size.width, size.height]).drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
	}
	const bytes = await pdf.save();
	return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
