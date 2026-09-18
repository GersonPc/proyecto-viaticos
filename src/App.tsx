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
	toCents,
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
	const updateMap = <Key extends 'kilometers' | 'price' | 'date' | 'kind'>(id: string, key: Key, value: TravelImage[Key]) =>
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
					return { id: `map-image-${nextImageId++}`, name: file.name, src, kind: 'route' as const, kilometers: '', price: '', date };
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
						<img
							src="data:image/png;base64,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"
							alt="TECNASA"
						/>
					</div>
					<div>
						<p className="eyebrow">TECNASA · PORTAL DE COLABORADORES</p>
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
								<p>Sube cada imagen y selecciona Recorrido o Insumos.</p>
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
							Los recorridos suman combustible según sus kilómetros. Los insumos suman su precio en quetzales. Cada gasto se asigna a la
							fecha de la imagen.
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
											<label className="full-width">
												<span>Tipo de gasto</span>
												<select
													aria-label={`Tipo de gasto de imagen ${index + 1}`}
													value={image.kind}
													onChange={(event) => updateMap(image.id, 'kind', event.target.value as TravelImage['kind'])}
												>
													<option value="route">Recorrido</option>
													<option value="supplies">Insumos</option>
												</select>
											</label>
											<label>
												<span>{image.kind === 'supplies' ? 'Precio (Q)' : 'Kilómetros'}</span>
												<input
													aria-label={`${image.kind === 'supplies' ? 'Precio (Q)' : 'Kilómetros'} de imagen ${index + 1}`}
													type="number"
													min="0"
													step="0.01"
													placeholder="Ej. 100"
													value={image.kind === 'supplies' ? image.price : image.kilometers}
													onChange={(event) => updateMap(image.id, image.kind === 'supplies' ? 'price' : 'kilometers', event.target.value)}
												/>
											</label>
											<label>
												<span>{image.kind === 'supplies' ? 'Fecha del gasto' : 'Fecha del recorrido'}</span>
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
												{image.kind === 'supplies' ? (
													<>
														Insumos: <strong>Q{money(toCents(image.price))}</strong>
													</>
												) : (
													<>
														Combustible: <strong>Q{money(imageFuelCost(image))}</strong> · {image.kilometers || '0'} km × Q1.30
													</>
												)}
											</p>
											{image.date && !tripDates(form.request).includes(image.date) && (
												<p className="full-width map-warning">
													Esta fecha está fuera del viaje. Ajusta la fecha de la imagen o las fechas de salida y regreso.
												</p>
											)}
											{(image.kind === 'supplies' ? image.price : image.kilometers) &&
												!validDecimal(image.kind === 'supplies' ? image.price : image.kilometers) && (
													<p className="full-width map-warning">
														{image.kind === 'supplies'
															? 'Usa un precio en quetzales desde 0, con hasta dos decimales.'
															: 'Usa kilómetros desde 0, con hasta dos decimales.'}
													</p>
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
