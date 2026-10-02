import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
import { createRequestPdf } from './pdf';
import { pdfFileName } from './pdfFileName';

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

type AccountProfile = {
	name: string;
	account: { number: string; type: string; bank: string } | null;
};

function createInitialForm(profile?: AccountProfile, signature = ''): RequestForm {
	const today = new Date();
	const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	return {
		...initialForm,
		person: { ...initialForm.person, name: profile?.name ?? '', signature },
		account: profile?.account ?? { number: '', type: '', bank: '' },
		request: { ...initialForm.request, date },
	};
}

const fileToDataUrl = (file: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

async function prepareStoredSignature(file: File, src: string): Promise<Blob> {
	if (file.size <= 1_500_000) return file;
	const image = new Image();
	image.src = src;
	await image.decode();
	for (const maxDimension of [1200, 900, 600, 400]) {
		const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
		canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
		canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
		if (blob?.type === 'image/webp' && blob.size <= 1_500_000) return blob;
	}
	throw new Error('No se pudo reducir la firma para guardarla. Selecciona una imagen más pequeña.');
}

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
	const [profile, setProfile] = useState<AccountProfile | null>(null);
	const [profileError, setProfileError] = useState('');
	const [accountBusy, setAccountBusy] = useState(false);
	const [accountNotice, setAccountNotice] = useState('');
	const [accountError, setAccountError] = useState('');
	const [savedSignature, setSavedSignature] = useState<string | null>(null);
	const [pendingSignature, setPendingSignature] = useState<{ file: File; src: string } | null>(null);
	const [signatureBusy, setSignatureBusy] = useState(false);
	const [signatureNotice, setSignatureNotice] = useState('');
	const mapImages = form.request.images;
	const setMapImages = (update: (images: TravelImage[]) => TravelImage[]) =>
		setForm((current) => ({ ...current, request: { ...current.request, images: update(current.request.images) } }));
	const updateMap = <Key extends 'kilometers' | 'price' | 'date' | 'kind'>(id: string, key: Key, value: TravelImage[Key]) =>
		setMapImages((images) => images.map((image) => (image.id === id ? { ...image, [key]: value } : image)));
	const [errors, setErrors] = useState<string[]>([]);
	const [preparingPdf, setPreparingPdf] = useState(false);
	const [preparedPdf, setPreparedPdf] = useState<{ file: File; url: string; form: RequestForm } | null>(null);
	const [pdfNotice, setPdfNotice] = useState('');
	const printAreaRef = useRef<HTMLDivElement>(null);
	const currentFormRef = useRef(form);
	useLayoutEffect(() => {
		currentFormRef.current = form;
	}, [form]);
	const readyFile = preparedPdf?.form === form ? preparedPdf.file : null;
	const readyUrl = preparedPdf?.form === form ? preparedPdf.url : null;
	const canSharePdf = Boolean(
		readyFile &&
		typeof navigator.share === 'function' &&
		typeof navigator.canShare === 'function' &&
		navigator.canShare({ files: [readyFile] }),
	);
	useEffect(() => {
		return () => {
			if (preparedPdf) URL.revokeObjectURL(preparedPdf.url);
		};
	}, [preparedPdf]);
	const mapPageCount = Math.ceil(mapImages.length / IMAGES_PER_MAP_PAGE);

	const updateAccount = (key: keyof RequestForm['account'], value: string) =>
		setForm((current) => (profile?.account ? current : { ...current, account: { ...current.account, [key]: value } }));

	useEffect(() => {
		const controller = new AbortController();
		void fetch('/api/me', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) {
					const body = (await response.json().catch(() => ({}))) as { error?: string };
					throw new Error(body.error || 'No se pudo verificar tu acceso. Recarga la página para intentar de nuevo.');
				}
				const data = (await response.json()) as AccountProfile;
				if (
					typeof data.name !== 'string' ||
					(!data.name.trim() && data.account !== null) ||
					(data.account !== null && (!data.account?.number || !data.account?.type || !data.account?.bank))
				) {
					throw new Error('El registro de tu cuenta está incompleto. Contacta al administrador.');
				}
				let storedSignature = '';
				try {
					const signatureResponse = await fetch('/api/signature', {
						cache: 'no-store',
						credentials: 'same-origin',
						signal: controller.signal,
					});
					if (signatureResponse.ok && signatureResponse.status === 200) {
						storedSignature = await fileToDataUrl(await signatureResponse.blob());
					} else if (signatureResponse.status !== 204) {
						throw new Error('No se pudo cargar tu firma guardada. Puedes intentar de nuevo al recargar la página.');
					}
				} catch {
					if (!controller.signal.aborted) {
						setSignatureNotice('No se pudo cargar tu firma guardada. Puedes intentar de nuevo al recargar la página.');
					}
				}
				if (controller.signal.aborted) return;
				setSavedSignature(storedSignature || null);
				setProfile(data);
				setForm(createInitialForm(data, storedSignature));
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setProfileError(error instanceof Error ? error.message : 'No se pudo cargar tu cuenta.');
			});
		return () => controller.abort();
	}, []);

	const saveAccount = async () => {
		if (!profile || profile.account || accountBusy) return;
		setAccountError('');
		if (![form.person.name, form.account.number, form.account.type, form.account.bank].every((value) => value.trim())) {
			setAccountError('Completa tu nombre, número de cuenta, tipo y banco para guardar.');
			return;
		}
		setAccountBusy(true);
		try {
			const response = await fetch('/api/me', {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: form.person.name, account: form.account }),
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error || 'No se pudo guardar tu cuenta. Intenta de nuevo.');
			}
			const data = (await response.json()) as AccountProfile;
			setProfile(data);
			setForm((current) => ({ ...current, person: { ...current.person, name: data.name }, account: data.account! }));
			setAccountNotice('Tu cuenta quedó guardada y se cargará automáticamente cuando vuelvas a ingresar.');
		} catch (error) {
			setAccountError(error instanceof Error ? error.message : 'No se pudo guardar tu cuenta. Intenta de nuevo.');
		} finally {
			setAccountBusy(false);
		}
	};

	const validate = () => {
		const nextErrors = validateRequest(form.request);
		if (!form.person.name.trim()) nextErrors.push('Ingresa el nombre del beneficiario.');
		if (!form.account.number.trim()) nextErrors.push('Ingresa el número de cuenta.');
		if (!form.account.bank.trim() || !form.account.type.trim()) nextErrors.push('Completa la descripción y el tipo de cuenta.');
		if (!profile?.account) nextErrors.push('Guarda tu cuenta en Transferencia antes de generar el PDF.');
		setErrors(nextErrors);
		return nextErrors.length === 0;
	};

	const preparePdf = async () => {
		if (preparingPdf) return;
		if (!validate()) {
			window.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		setPreparingPdf(true);
		setPreparedPdf(null);
		setPdfNotice('');
		try {
			if (!printAreaRef.current) throw new Error('No se encontró la vista previa del documento.');
			const blob = await createRequestPdf(printAreaRef.current);
			if (currentFormRef.current !== form) return;
			const file = new File([blob], pdfFileName(form.request), { type: 'application/pdf' });
			setPreparedPdf({ file, url: URL.createObjectURL(file), form });
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} catch (error) {
			setPdfNotice(error instanceof Error ? error.message : 'No se pudo generar el PDF. Intenta de nuevo.');
		} finally {
			setPreparingPdf(false);
		}
	};

	const sharePdf = async () => {
		if (!readyFile) return;
		if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [readyFile] })) {
			setPdfNotice('Este navegador no permite compartir archivos. Descarga el PDF y adjúntalo desde tu aplicación de correo.');
			return;
		}
		setPdfNotice('');
		try {
			await navigator.share({ files: [readyFile], title: 'Solicitud de viáticos' });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			setPdfNotice('No se pudo abrir el menú para compartir. Descarga el PDF y adjúntalo desde tu aplicación de correo.');
		}
	};

	const downloadPdf = () => {
		if (!readyFile || !readyUrl) return;
		const link = document.createElement('a');
		link.href = readyUrl;
		link.download = readyFile.name;
		document.body.appendChild(link);
		link.click();
		link.remove();
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
			setForm((current) => ({ ...current, person: { ...current.person, signature: src } }));
			setPendingSignature({ file, src });
			setSignatureNotice('');
			setErrors([]);
		} catch {
			setErrors(['No se pudo abrir la imagen de la firma. Selecciona otro archivo.']);
		}
	};

	const saveSignature = async () => {
		if (!pendingSignature || signatureBusy) return;
		setSignatureBusy(true);
		try {
			const storedFile = await prepareStoredSignature(pendingSignature.file, pendingSignature.src);
			const response = await fetch('/api/signature', {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { 'Content-Type': storedFile.type },
				body: storedFile,
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error || 'No se pudo guardar la firma.');
			}
			setSavedSignature(await fileToDataUrl(storedFile));
			setPendingSignature(null);
			setSignatureNotice('Tu firma quedó guardada y se utilizará automáticamente en próximas solicitudes.');
		} catch (error) {
			setSignatureNotice(error instanceof Error ? error.message : 'No se pudo guardar la firma.');
		} finally {
			setSignatureBusy(false);
		}
	};

	const deleteSavedSignature = async () => {
		if (!savedSignature || signatureBusy) return;
		if (!window.confirm('¿Eliminar tu firma guardada? También se quitará de esta solicitud si está en uso.')) return;
		setSignatureBusy(true);
		try {
			const response = await fetch('/api/signature', { method: 'DELETE', credentials: 'same-origin' });
			if (!response.ok) throw new Error('No se pudo eliminar la firma guardada. Intenta de nuevo.');
			setForm((current) =>
				current.person.signature === savedSignature ? { ...current, person: { ...current.person, signature: '' } } : current,
			);
			setSavedSignature(null);
			setSignatureNotice('Tu firma guardada se eliminó.');
		} catch (error) {
			setSignatureNotice(error instanceof Error ? error.message : 'No se pudo eliminar la firma guardada.');
		} finally {
			setSignatureBusy(false);
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
		setForm(createInitialForm(profile ?? undefined, savedSignature ?? ''));
		setPendingSignature(null);
		setSignatureNotice('');
		setAccountError('');
		setErrors([]);
	};

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		void preparePdf();
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
						description: 'Completa la fecha del borrador visible. No genera ni envía el PDF.',
						inputSchema: {
							type: 'object',
							properties: {
								requestDate: { type: 'string', description: 'Fecha en formato AAAA-MM-DD.' },
							},
							required: ['requestDate'],
							additionalProperties: false,
						},
						annotations: { readOnlyHint: false, untrustedContentHint: false },
						execute(input) {
							if (!input || typeof input !== 'object') throw new Error('Los datos de la solicitud no son válidos.');
							const data = input as Record<string, unknown>;
							if (typeof data.requestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.requestDate) || !formatDate(data.requestDate)) {
								throw new Error('requestDate debe usar el formato AAAA-MM-DD.');
							}
							setForm((current) => ({
								...current,
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

	if (!profile) {
		return (
			<main className="app-shell">
				<section className="form-panel" aria-live="polite">
					<h1>Solicitud de viáticos</h1>
					<p>{profileError || 'Consultando tus datos de cuenta…'}</p>
					{profileError && (
						<button type="button" onClick={() => window.location.reload()}>
							Intentar de nuevo
						</button>
					)}
				</section>
			</main>
		);
	}

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
					<span className="draft-status">La solicitud permanece en este dispositivo</span>
					<button type="button" className="primary-button" disabled={preparingPdf} onClick={() => void preparePdf()}>
						{preparingPdf ? 'Preparando PDF…' : 'Generar PDF'}
					</button>
				</div>
			</header>

			{(readyFile || pdfNotice) && (
				<div className="pdf-result" role="status" aria-live="polite">
					{readyFile && (
						<>
							<div>
								<strong>PDF listo para compartir</strong>
								<p>Elige una aplicación y revisa el mensaje antes de enviarlo.</p>
							</div>
							<div className="pdf-result-actions">
								{canSharePdf && (
									<button type="button" className="primary-button" onClick={() => void sharePdf()}>
										Compartir PDF
									</button>
								)}
								<a className="secondary-button" href={readyUrl ?? undefined} target="_blank" rel="noopener noreferrer">
									Ver PDF
								</a>
								<button type="button" className="secondary-button" onClick={downloadPdf}>
									Descargar PDF
								</button>
							</div>
							{!canSharePdf && <p>El menú de compartir archivos no está disponible aquí. Descarga el PDF para adjuntarlo manualmente.</p>}
						</>
					)}
					{pdfNotice && <p>{pdfNotice}</p>}
				</div>
			)}

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
									readOnly={Boolean(profile.name)}
									disabled={accountBusy}
									placeholder={profile.name ? '' : 'Tu nombre completo'}
									onChange={(event) => setForm((current) => ({ ...current, person: { ...current.person, name: event.target.value } }))}
								/>
								<small>Nombre asociado a tu correo. Se usa también en el titular de la cuenta, solicitado por y elaborado por.</small>
							</label>
							<label>
								<span>
									No. de Cuenta <em>*</em>
								</span>
								<input
									value={form.account.number}
									maxLength={40}
									onChange={(event) => updateAccount('number', event.target.value)}
									readOnly={Boolean(profile.account)}
									disabled={accountBusy}
									placeholder={profile.account ? '' : 'Número de cuenta'}
								/>
							</label>
							<label>
								<span>
									Tipo de cuenta <em>*</em>
								</span>
								<input
									value={form.account.type}
									maxLength={40}
									readOnly={Boolean(profile.account)}
									disabled={accountBusy}
									onChange={(event) => updateAccount('type', event.target.value)}
								/>
							</label>
							<label className="full-width">
								<span>
									Descripción de la cuenta / Banco <em>*</em>
								</span>
								<input
									value={form.account.bank}
									maxLength={80}
									readOnly={Boolean(profile.account)}
									disabled={accountBusy}
									onChange={(event) => updateAccount('bank', event.target.value)}
								/>
							</label>
							<p className="full-width">
								{profile.account
									? 'Estos datos bancarios están guardados y asociados a tu correo.'
									: 'Tu cuenta aún no está registrada. Completa tus datos y pulsa Guardar cuenta; se cargarán en tus próximas solicitudes.'}
							</p>
							{!profile.account && (
								<div className="full-width">
									<button type="button" className="primary-button" onClick={() => void saveAccount()} disabled={accountBusy}>
										{accountBusy ? 'Guardando…' : 'Guardar cuenta'}
									</button>
								</div>
							)}
							{accountError && (
								<p className="full-width map-warning" role="alert">
									{accountError}
								</p>
							)}
							{accountNotice && (
								<p className="full-width signature-notice" role="status">
									{accountNotice}
								</p>
							)}
							<label className="full-width">
								<span>Firma del beneficiario / Elaborado por</span>
								<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSignature} disabled={signatureBusy} />
								<small>
									La misma firma se utiliza en ambas hojas. PNG, JPG o WebP, hasta 5 MB. Puedes usarla solo ahora o guardarla para futuras
									solicitudes.
								</small>
							</label>
							{pendingSignature && (
								<div className="signature-save-prompt full-width" role="group" aria-label="Decidir si guardar la firma">
									<strong>
										{savedSignature
											? '¿Deseas reemplazar tu firma guardada con esta imagen?'
											: '¿Deseas guardar tu firma en la aplicación para próximas solicitudes?'}
									</strong>
									<p>Se cargará cuando ingreses con tu correo. Si prefieres, la imagen se usará únicamente en esta solicitud.</p>
									<div className="signature-actions">
										<button type="button" className="primary-button" onClick={() => void saveSignature()} disabled={signatureBusy}>
											{signatureBusy ? 'Guardando…' : savedSignature ? 'Reemplazar firma guardada' : 'Guardar para próximas solicitudes'}
										</button>
										<button
											type="button"
											className="secondary-button"
											onClick={() => {
												setPendingSignature(null);
												setSignatureNotice('Esta firma se usará solo en la solicitud actual.');
											}}
											disabled={signatureBusy}
										>
											Solo esta solicitud
										</button>
									</div>
								</div>
							)}
							{signatureNotice && (
								<p className="signature-notice full-width" role="status">
									{signatureNotice}
								</p>
							)}
							{form.person.signature && (
								<div className="signature-preview full-width">
									<img src={form.person.signature} alt={`Firma de ${form.person.name || 'la persona beneficiaria'}`} />
									<button
										type="button"
										className="secondary-button"
										onClick={() => {
											setForm((current) => ({ ...current, person: { ...current.person, signature: '' } }));
											setPendingSignature(null);
										}}
									>
										Quitar de esta solicitud
									</button>
								</div>
							)}
							{savedSignature && (
								<div className="signature-saved-controls full-width">
									<span>Tu firma personal está guardada para próximas solicitudes.</span>
									<div className="signature-actions">
										{!form.person.signature && (
											<button
												type="button"
												className="secondary-button"
												onClick={() => setForm((current) => ({ ...current, person: { ...current.person, signature: savedSignature } }))}
											>
												Usar firma guardada
											</button>
										)}
										<button type="button" className="secondary-button" onClick={() => void deleteSavedSignature()} disabled={signatureBusy}>
											Eliminar firma guardada
										</button>
									</div>
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
						<button type="submit" disabled={preparingPdf} className="primary-button large">
							{preparingPdf ? 'Preparando PDF…' : 'Generar PDF'} <span>→</span>
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
					<div className="print-area" ref={printAreaRef}>
						<TransferPage form={form} />
						<RequestPages form={form} />
						<MapPages images={mapImages} />
					</div>
				</aside>
			</section>
		</main>
	);
}
