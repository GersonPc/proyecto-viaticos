import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { TransferPage } from './TransferPage';
import {
	initialForm,
	formatDate,
	requestPages,
	validateRequest,
	type RequestForm,
	type TravelImage,
	imageFuelCost,
	money,
	tripDates,
	validDecimal,
} from './request';
import { RequestPages } from './RequestPage';
import { RequestFields } from './RequestFields';

type WebMcpTool = {
	name: string;
	title?: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
	execute: (input: unknown) => unknown | Promise<unknown>;
};

type ModelContext = {
	registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const IMAGES_PER_MAP_PAGE = 3;
let nextImageId = 1;

function createInitialForm(): RequestForm {
	const today = new Date();
	const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	return { ...initialForm, request: { ...initialForm.request, date } };
}

const fileToDataUrl = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

function MapPage({ images, pageNumber }: { images: TravelImage[]; pageNumber: number }) {
	return (
		<section className="paper-sheet portrait-sheet map-sheet" aria-label={`Mapa y cotización, página ${pageNumber}`}>
			<div className={`map-image-grid images-${images.length}`}>
				{images.map((image, index) => (
					<figure key={image.id}>
						<img src={image.src} alt={`Ruta o cotización adjunta ${index + 1}`} />
					</figure>
				))}
			</div>
		</section>
	);
}

function MapPages({ images }: { images: TravelImage[] }) {
	const pages: TravelImage[][] = [];
	for (let index = 0; index < images.length; index += IMAGES_PER_MAP_PAGE) {
		pages.push(images.slice(index, index + IMAGES_PER_MAP_PAGE));
	}

	return pages.map((pageImages, index) => (
		<MapPage key={pageImages.map((image) => image.id).join('-')} images={pageImages} pageNumber={index + 1} />
	));
}

export default function App() {
	const [form, setForm] = useState<RequestForm>(createInitialForm);
	const mapImages = form.request.images;
	const setMapImages = (update: (images: TravelImage[]) => TravelImage[]) =>
		setForm((current) => ({ ...current, request: { ...current.request, images: update(current.request.images) } }));
	const updateMap = (id: string, key: 'kilometers' | 'date', value: string) =>
		setMapImages((images) => images.map((image) => (image.id === id ? { ...image, [key]: value } : image)));
	const [errors, setErrors] = useState<string[]>([]);
	const [preparingPrint, setPreparingPrint] = useState(false);
	const mapPageCount = Math.ceil(mapImages.length / IMAGES_PER_MAP_PAGE);

	const updatePerson = (key: keyof RequestForm['person'], value: string) =>
		setForm((current) => ({ ...current, person: { ...current.person, [key]: value } }));
	const updateAccount = (key: keyof RequestForm['account'], value: string) =>
		setForm((current) => ({ ...current, account: { ...current.account, [key]: value } }));

	const validate = () => {
		const nextErrors = validateRequest(form.request);
		if (!form.person.name.trim()) nextErrors.push('Ingresa el nombre del beneficiario.');
		if (!form.account.number.trim()) nextErrors.push('Ingresa el número de cuenta.');
		if (!form.account.bank.trim() || !form.account.type.trim()) nextErrors.push('Completa la descripción y el tipo de cuenta.');
		setErrors(nextErrors);
		return nextErrors.length === 0;
	};

	const handlePrint = async () => {
		if (preparingPrint) return;
		if (!validate()) {
			window.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		setPreparingPrint(true);
		try {
			const templates = ['/transfer-template.svg', '/request-template.svg'].map((src) => {
				const image = new Image();
				image.src = src;
				return image.decode();
			});
			await Promise.all([document.fonts.ready, ...templates, ...Array.from(document.images, (image) => image.decode())]);
		} catch {
			setErrors(['No se pudo cargar una imagen del documento. Revisa los archivos antes de generar el PDF.']);
			setPreparingPrint(false);
			return;
		}
		const previousTitle = document.title;
		const safeName = form.person.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-');
		document.title = `Solicitud-de-viaticos-${safeName}`;
		window.addEventListener(
			'afterprint',
			() => {
				document.title = previousTitle;
			},
			{ once: true },
		);
		window.setTimeout(() => {
			window.print();
			setPreparingPrint(false);
		}, 80);
	};

	const handleSignature = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
			setErrors(['La firma debe ser PNG, JPG o WebP y no superar 5 MB.']);
			return;
		}
		try {
			const src = await fileToDataUrl(file);
			const image = new Image();
			image.src = src;
			await image.decode();
			updatePerson('signature', src);
			setErrors([]);
		} catch {
			setErrors(['No se pudo abrir la imagen de la firma. Selecciona otro archivo.']);
		}
	};

	const handleMapImage = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = '';
		const date = form.request.departureDate;
		try {
			const uploaded = await Promise.all(
				files.map(async (file) => {
					if (!file.type.startsWith('image/')) throw new Error('Selecciona archivos de imagen para los mapas o cotizaciones.');
					const src = await fileToDataUrl(file);
					const decoded = new Image();
					decoded.src = src;
					await decoded.decode();
					return { id: `map-image-${nextImageId++}`, name: file.name, src, kilometers: '', date };
				}),
			);
			setMapImages((current) => [...current, ...uploaded]);
			setErrors([]);
		} catch {
			setErrors(['No se pudo abrir alguna imagen. Revisa los archivos de mapas o cotizaciones.']);
		}
	};

	const resetForm = () => {
		if (!window.confirm('¿Deseas borrar los datos de esta solicitud?')) return;
		setForm(createInitialForm());
		setErrors([]);
	};

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		handlePrint();
	};

	useEffect(() => {
		const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
		if (!modelContext?.registerTool) return;
		const lifecycle = new AbortController();
		try {
			void Promise.resolve(
				modelContext.registerTool(
					{
						name: 'stage_travel_request',
						title: 'Preparar solicitud de viáticos',
						description: 'Completa la fecha y el beneficiario del borrador visible. No genera ni envía el PDF.',
						inputSchema: {
							type: 'object',
							properties: {
								requestDate: { type: 'string', description: 'Fecha en formato AAAA-MM-DD.' },
								beneficiaryName: { type: 'string' },
							},
							required: ['requestDate', 'beneficiaryName'],
							additionalProperties: false,
						},
						annotations: { readOnlyHint: false, untrustedContentHint: false },
						execute(input) {
							if (!input || typeof input !== 'object') throw new Error('Los datos de la solicitud no son válidos.');
							const data = input as Record<string, unknown>;
							if (typeof data.requestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.requestDate) || !formatDate(data.requestDate)) {
								throw new Error('requestDate debe usar el formato AAAA-MM-DD.');
							}
							if (typeof data.beneficiaryName !== 'string' || !data.beneficiaryName.trim()) {
								throw new Error('beneficiaryName debe contener un nombre.');
							}
							setForm((current) => ({
								...current,
								person: { ...current.person, name: String(data.beneficiaryName).trim() },
								request: { ...current.request, date: String(data.requestDate) },
							}));
							return { status: 'draft_staged' };
						},
					},
					{ signal: lifecycle.signal },
				),
			).catch(() => undefined);
		} catch {
			// WebMCP es opcional; el formulario funciona sin esta integración.
		}
		return () => lifecycle.abort();
	}, []);

	return (
		<main className="app-shell">
			<header className="topbar">
				<div className="brand-lockup">
					<div className="logo-tile">
						<img src="/tecnasa-logo.png" alt="TECNASA" />
					</div>
					<div>
						<p className="eyebrow">GESTIÓN DE VIÁTICOS</p>
						<h1>Solicitud de viáticos</h1>
					</div>
				</div>
				<div className="header-actions">
					<span className="draft-status">Los datos permanecen en este dispositivo</span>
					<button type="button" className="primary-button" disabled={preparingPrint} onClick={handlePrint}>
						Generar PDF
					</button>
				</div>
			</header>

			{errors.length > 0 && (
				<div className="error-banner" role="alert">
					<strong>Falta información para generar el PDF</strong>
					<ul>
						{errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			)}

			<section className="workspace">
				<form className="form-column" onSubmit={handleSubmit}>
					<section className="form-panel">
						<div className="section-heading">
							<span>01</span>
							<div>
								<h2>Transferencia</h2>
								<p>Datos de la persona beneficiaria y su cuenta.</p>
							</div>
						</div>
						<div className="field-grid">
							<label className="full-width">
								<span>
									Nombre del beneficiario <em>*</em>
								</span>
								<input
									value={form.person.name}
									maxLength={100}
									onChange={(event) => updatePerson('name', event.target.value)}
									placeholder="Nombre completo"
								/>
								<small>Se usa también en el titular de la cuenta, solicitado por y elaborado por.</small>
							</label>
							<label>
								<span>
									No. de Cuenta <em>*</em>
								</span>
								<input
									value={form.account.number}
									maxLength={40}
									onChange={(event) => updateAccount('number', event.target.value)}
									placeholder="Número de cuenta"
								/>
							</label>
							<label>
								<span>
									Tipo de cuenta <em>*</em>
								</span>
								<input value={form.account.type} maxLength={40} onChange={(event) => updateAccount('type', event.target.value)} />
							</label>
							<label className="full-width">
								<span>
									Descripción de la cuenta / Banco <em>*</em>
								</span>
								<input value={form.account.bank} maxLength={80} onChange={(event) => updateAccount('bank', event.target.value)} />
							</label>
							<label className="full-width">
								<span>Firma del beneficiario / Elaborado por</span>
								<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSignature} />
								<small>La misma firma se utiliza en ambas hojas. PNG, JPG o WebP, hasta 5 MB.</small>
							</label>
							{form.person.signature && (
								<div className="signature-preview full-width">
									<img src={form.person.signature} alt={`Firma de ${form.person.name || 'la persona beneficiaria'}`} />
									<button type="button" className="secondary-button" onClick={() => updatePerson('signature', '')}>
										Quitar firma
									</button>
								</div>
							)}
						</div>
						<p className="field-note">
							Los encabezados y datos administrativos del formato están fijos. La fecha, el objetivo y las cantidades se completan desde
							Solicitud.
						</p>
					</section>

					<RequestFields form={form} setForm={setForm} />

					<section className="form-panel">
						<div className="section-heading">
							<span>03</span>
							<div>
								<h2>Mapa-Cotización</h2>
								<p>Sube cada imagen e indica los kilómetros y la fecha del recorrido.</p>
							</div>
						</div>
						<label className={`upload-box ${mapImages.length ? 'has-file' : ''}`}>
							<input type="file" accept="image/*" multiple onChange={handleMapImage} />
							<span className="upload-icon">＋</span>
							<strong>{mapImages.length ? 'Agregar más imágenes' : 'Subir imágenes'}</strong>
							<small>
								{mapImages.length
									? `${mapImages.length} ${mapImages.length === 1 ? 'imagen cargada' : 'imágenes cargadas'}`
									: 'Puedes seleccionar varias imágenes a la vez'}
							</small>
						</label>
						<p className="field-note">
							Si una cotización no incluye recorrido, indica 0 km. Las imágenes de una misma fecha suman su combustible en ese día.
						</p>
						{mapImages.length > 0 && (
							<div className="map-image-list">
								{mapImages.map((image, index) => (
									<div className="map-card" key={image.id}>
										<img src={image.src} alt="" />
										<span>
											<strong>Imagen {index + 1}</strong>
											<small>{image.name}</small>
										</span>
										<button
											type="button"
											onClick={() => setMapImages((current) => current.filter((item) => item.id !== image.id))}
											aria-label={`Quitar ${image.name}`}
										>
											×
										</button>
										<div className="map-metadata field-grid">
											<label>
												<span>Kilómetros</span>
												<input
													aria-label={`Kilómetros de imagen ${index + 1}`}
													type="number"
													min="0"
													step="0.01"
													placeholder="Ej. 100"
													value={image.kilometers}
													onChange={(event) => updateMap(image.id, 'kilometers', event.target.value)}
												/>
											</label>
											<label>
												<span>Fecha del recorrido</span>
												<input
													aria-label={`Fecha de imagen ${index + 1}`}
													type="date"
													min={form.request.departureDate || undefined}
													max={form.request.returnDate || undefined}
													value={image.date}
													onChange={(event) => updateMap(image.id, 'date', event.target.value)}
												/>
											</label>
											<p className="full-width map-fuel">
												Combustible: <strong>Q{money(imageFuelCost(image))}</strong> · {image.kilometers || '0'} km × Q1.30
											</p>
											{image.date && !tripDates(form.request).includes(image.date) && (
												<p className="full-width map-warning">
													Esta fecha está fuera del viaje. Ajusta la fecha del recorrido o las fechas de salida y regreso.
												</p>
											)}
											{image.kilometers && !validDecimal(image.kilometers) && (
												<p className="full-width map-warning">Usa kilómetros desde 0, con hasta dos decimales.</p>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<div className="form-actions">
						<button type="button" className="secondary-button" onClick={resetForm}>
							Limpiar formulario
						</button>
						<button type="submit" disabled={preparingPrint} className="primary-button large">
							Generar PDF <span>→</span>
						</button>
					</div>
				</form>

				<aside className="preview-panel" aria-label="Vista previa del PDF">
					<div className="preview-toolbar">
						<div>
							<span>VISTA PREVIA</span>
							<strong>{1 + requestPages(form.request).length + mapPageCount} páginas</strong>
						</div>
						<div className="preview-sections">
							<span>Transferencia</span>
							<span>Solicitud</span>
							{mapImages.length > 0 && <span>Mapa-Cotización ({mapPageCount})</span>}
						</div>
					</div>
					<div className="print-area">
						<TransferPage form={form} />
						<RequestPages form={form} />
						<MapPages images={mapImages} />
					</div>
				</aside>
			</section>
		</main>
	);
}
