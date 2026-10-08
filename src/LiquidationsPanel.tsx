import { useEffect, useRef, useState } from 'react';
import { api, jsonOptions } from './api';
import { createPortal } from 'react-dom';
import { formatDate, money } from './request';
import { pastedImageFiles, readClipboardImages } from './imageClipboard';
import { prepareReceiptImage, cropReceipt, rotateReceipt } from './receiptImage';
import { createLiquidationPdf } from './pdf';
import { pdfFileName } from './pdfFileName';
import { LiquidationPages } from './LiquidationPages';
import {
	initialLiquidation,
	liquidationTotals,
	validateLiquidation,
	MAX_RECEIPTS,
	type LiquidationData,
	type LiquidationDetail,
	type LiquidationList,
	type LiquidationRecord,
	type Receipt,
} from './liquidation';

const message = (e: unknown) => (e instanceof Error ? e.message : 'No se pudo completar la operación. Intenta de nuevo.');
export const liquidationNavigationEvent = 'viaticos:leave-liquidation';
const progressLabel = (status?: string) => (status === 'submitted' ? 'Finalizada' : status === 'draft' ? 'Borrador' : 'Por liquidar');
type Selection = { id: string; admin: boolean };
type Props = {
	selection: Selection | null;
	onOpen: (id: string, admin?: boolean) => void;
	onClose: () => void;
	onBusy: (busy: boolean) => void;
};
export function LiquidationsPanel({ selection, onOpen, onClose, onBusy }: Props) {
	return selection ? (
		<LiquidationLoader key={`${selection.admin}:${selection.id}`} selection={selection} onClose={onClose} onBusy={onBusy} />
	) : (
		<LiquidationInbox onOpen={onOpen} />
	);
}
function LiquidationInbox({ onOpen }: Pick<Props, 'onOpen'>) {
	const [page, setPage] = useState<LiquidationList>({ requests: [], nextCursor: null, progress: {} });
	const [busy, setBusy] = useState(true),
		[error, setError] = useState(''),
		[reload, setReload] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		void api<LiquidationList>('/api/liquidations', { signal: controller.signal })
			.then(setPage)
			.catch((e) => {
				if (!controller.signal.aborted) setError(message(e));
			})
			.finally(() => {
				if (!controller.signal.aborted) setBusy(false);
			});
		return () => controller.abort();
	}, [reload]);
	const more = async () => {
		if (busy || !page.nextCursor) return;
		setBusy(true);
		setError('');
		try {
			const next = await api<LiquidationList>(`/api/liquidations?cursor=${encodeURIComponent(page.nextCursor)}`);
			setPage((p) => ({
				requests: [...p.requests, ...next.requests],
				nextCursor: next.nextCursor,
				progress: { ...p.progress, ...next.progress },
			}));
		} catch (e) {
			setError(message(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="requests-panel liquidation-inbox" aria-label="Mis liquidaciones">
			<div className="requests-heading">
				<div>
					<p className="eyebrow">CIERRE DEL VIAJE</p>
					<h2>Mis liquidaciones</h2>
					<p>Selecciona una solicitud aceptada y reúne los comprobantes de tu viaje.</p>
				</div>
				<button
					className="secondary-button"
					disabled={busy}
					onClick={() => {
						setBusy(true);
						setError('');
						setReload((r) => r + 1);
					}}
				>
					Actualizar
				</button>
			</div>
			{error && (
				<p className="workflow-error" role="alert">
					{error}
				</p>
			)}
			<div className="liquidation-cards">
				{page.requests.map((item) => (
					<article className="liquidation-card" key={item.id}>
						<div className="liquidation-card-top">
							<span className={`status-chip ${page.progress[item.id]?.status === 'submitted' ? 'accepted' : 'pending'}`}>
								{progressLabel(page.progress[item.id]?.status)}
							</span>
							<span>Q {money(item.totalCents)} autorizados</span>
						</div>
						<h3>{item.summary.clients.join(', ') || item.summary.destinations.join(', ') || 'Viaje de trabajo'}</h3>
						<p>{item.summary.concept}</p>
						<p className="field-note">
							{formatDate(item.departureDate)} – {formatDate(item.returnDate)}
							<br />
							Tickets: {[...item.summary.serviceTickets, ...item.summary.projectTickets].join(', ') || 'Sin tickets'}
						</p>
						<button className="primary-button" disabled={busy} onClick={() => onOpen(item.id)}>
							{page.progress[item.id]?.status === 'submitted'
								? 'Ver liquidación'
								: page.progress[item.id]
									? 'Continuar liquidación'
									: 'Liquidar solicitud'}{' '}
							<span aria-hidden="true">→</span>
						</button>
					</article>
				))}
			</div>
			{busy && <p role="status">Cargando solicitudes…</p>}
			{!busy && !error && !page.requests.length && (
				<div className="liquidation-empty">
					<h3>Aquí comienza el cierre de tu viaje</h3>
					<p>Cuando administración acepte una solicitud, podrás agregar sus facturas y generar la liquidación.</p>
				</div>
			)}
			{page.nextCursor && (
				<button className="secondary-button load-more" disabled={busy} onClick={() => void more()}>
					Cargar más solicitudes
				</button>
			)}
		</section>
	);
}
function LiquidationLoader({ selection, onClose, onBusy }: { selection: Selection; onClose: () => void; onBusy: (v: boolean) => void }) {
	const [detail, setDetail] = useState<LiquidationDetail | null>(null),
		[error, setError] = useState(''),
		[retry, setRetry] = useState(0);
	const endpoint = `/api/${selection.admin ? 'admin/' : ''}requests/${selection.id}/liquidation`;
	useEffect(() => {
		const controller = new AbortController();
		void api<LiquidationDetail>(endpoint, { signal: controller.signal })
			.then(setDetail)
			.catch((e) => {
				if (!controller.signal.aborted) setError(message(e));
			});
		return () => controller.abort();
	}, [endpoint, retry]);
	if (!detail)
		return (
			<section className="requests-panel">
				<button className="secondary-button" onClick={onClose}>
					← Volver
				</button>
				{error ? (
					<>
						<p role="alert">{error}</p>
						<button
							className="primary-button"
							onClick={() => {
								setError('');
								setRetry((r) => r + 1);
							}}
						>
							Volver a intentar
						</button>
					</>
				) : (
					<p role="status">Abriendo liquidación…</p>
				)}
			</section>
		);
	return <LiquidationEditor detail={detail} endpoint={endpoint} admin={selection.admin} onClose={onClose} onBusy={onBusy} />;
}
function LiquidationEditor({
	detail,
	endpoint,
	admin,
	onClose,
	onBusy,
}: {
	detail: LiquidationDetail;
	endpoint: string;
	admin: boolean;
	onClose: () => void;
	onBusy: (v: boolean) => void;
}) {
	const [data, setData] = useState<LiquidationData>(() => detail.liquidation?.data ?? initialLiquidation());
	const [initialData] = useState(data);
	const [saved, setSaved] = useState<LiquidationRecord | null>(detail.liquidation);
	const [savedSource, setSavedSource] = useState<LiquidationData | null>(detail.liquidation?.data ?? null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string[]>([]),
		[notice, setNotice] = useState(''),
		[kind, setKind] = useState<'invoice' | 'refund'>('invoice'),
		[review, setReview] = useState(false);
	const [pdf, setPdf] = useState<{ source: LiquidationData; url: string; name: string } | null>(null);
	const inFlight = useRef(false),
		printArea = useRef<HTMLDivElement>(null);
	const intent = useRef<{ source: LiquidationData; status: string; key: string } | null>(null);
	const readOnly = admin || saved?.status === 'submitted';
	const dirty = !readOnly && data !== (savedSource ?? initialData);
	const totals = liquidationTotals(data, detail.item.totalCents);
	const lock = (v: boolean) => {
		inFlight.current = v;
		setBusy(v);
		onBusy(v);
	};
	useEffect(
		() => () => {
			onBusy(false);
		},
		[onBusy],
	);
	useEffect(
		() => () => {
			if (pdf) URL.revokeObjectURL(pdf.url);
		},
		[pdf],
	);
	useEffect(() => {
		const unload = (e: BeforeUnloadEvent) => {
			if (dirty) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		const leave = (e: Event) => {
			if (inFlight.current || (dirty && !window.confirm('Tienes cambios sin guardar. ¿Salir de la liquidación?'))) e.preventDefault();
		};
		window.addEventListener('beforeunload', unload);
		window.addEventListener(liquidationNavigationEvent, leave);
		return () => {
			window.removeEventListener('beforeunload', unload);
			window.removeEventListener(liquidationNavigationEvent, leave);
		};
	}, [dirty]);
	const update = (id: string, patch: Partial<Receipt>) => {
		setData((d) => ({ ...d, receipts: d.receipts.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
		setReview(false);
		setNotice('');
	};
	const add = async (getFiles: () => File[] | Promise<File[]>) => {
		if (inFlight.current || readOnly) return;
		lock(true);
		setError([]);
		setNotice('');
		try {
			const files = await getFiles();
			if (!files.length) throw new Error('Copia una imagen o selecciona un archivo para adjuntar.');
			if (data.receipts.length + files.length > MAX_RECEIPTS) throw new Error(`Puedes adjuntar hasta ${MAX_RECEIPTS} comprobantes.`);
			const uploaded: Receipt[] = [];
			for (const file of files)
				uploaded.push({
					id: crypto.randomUUID(),
					name: file.name.slice(0, 255),
					...(await prepareReceiptImage(file)),
					kind,
					date: kind === 'invoice' ? detail.item.departureDate : data.date,
					series: '',
					dte: '',
					nit: '',
					issuer: '',
					concept: kind === 'invoice' ? 'Alimentación' : 'Reintegro a TECNASA',
					amount: '',
					idp: '',
					base: '',
					iva: '',
				});
			const next = { ...data, receipts: [...data.receipts, ...uploaded] };
			if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 7_900_000)
				throw new Error('Los comprobantes superan el tamaño de guardado. Sube imágenes de menor tamaño.');
			setData(next);
			setReview(false);
			setNotice(`${uploaded.length === 1 ? 'Comprobante agregado' : 'Comprobantes agregados'}. Completa sus datos y revisa el recorte.`);
		} catch (e) {
			setError([message(e)]);
		} finally {
			lock(false);
		}
	};
	const save = async (status: 'draft' | 'submitted') => {
		if (inFlight.current || readOnly) return;
		const errors = validateLiquidation(data, detail.item, detail.snapshot.request, status === 'submitted');
		setError(errors);
		if (errors.length) return;
		const source = data;
		if (new TextEncoder().encode(JSON.stringify({ data: source })).byteLength > 7_900_000) {
			setError(['La liquidación supera el tamaño permitido. Reduce las imágenes.']);
			return;
		}
		if (!intent.current || intent.current.source !== source || intent.current.status !== status)
			intent.current = { source, status, key: crypto.randomUUID() };
		lock(true);
		setNotice('');
		try {
			const record = await api<LiquidationRecord>(
				endpoint,
				jsonOptions('PUT', { data: source, status, revision: saved?.revision ?? 0, key: intent.current.key }),
			);
			setSaved(record);
			setSavedSource(source);
			intent.current = null;
			setReview(false);
			setNotice(
				status === 'submitted'
					? 'Liquidación finalizada. Tus comprobantes quedaron guardados.'
					: 'Borrador guardado. Puedes continuar después desde Mis liquidaciones.',
			);
		} catch (e) {
			setError([message(e)]);
		} finally {
			lock(false);
		}
	};
	const processImage = async (id: string, operation: () => Promise<Partial<Receipt>>) => {
		if (inFlight.current || readOnly) return;
		lock(true);
		setError([]);
		try {
			update(id, await operation());
		} catch (e) {
			setError([message(e)]);
		} finally {
			lock(false);
		}
	};
	const generate = async () => {
		if (inFlight.current || !printArea.current) return;
		lock(true);
		setError([]);
		setNotice('');
		try {
			const blob = await createLiquidationPdf(printArea.current);
			const name = pdfFileName(detail.snapshot.request).replace('Solicitud de viáticos', 'Liquidación de viáticos');
			setPdf({ source: data, url: URL.createObjectURL(blob), name });
			setNotice('PDF preparado. Revisa el documento antes de compartirlo.');
		} catch (e) {
			setError([message(e)]);
		} finally {
			lock(false);
		}
	};
	return (
		<section className="liquidation-workspace" aria-label="Liquidación de viáticos">
			<div className="liquidation-heading">
				<div>
					<button className="liquidation-back" disabled={busy} onClick={onClose}>
						← {admin ? 'Volver a administración' : 'Mis liquidaciones'}
					</button>
					<p className="eyebrow">LIQUIDACIÓN DE VIÁTICOS</p>
					<h2>{detail.item.summary.clients[0] || 'Cierre del viaje'}</h2>
					<p>
						{detail.item.name} · {formatDate(detail.item.departureDate)} al {formatDate(detail.item.returnDate)}
					</p>
				</div>
				<span className={`status-chip ${readOnly && saved ? 'accepted' : 'pending'}`}>
					{admin && !saved ? 'Sin liquidación' : progressLabel(saved?.status)}
				</span>
			</div>
			<div className="liquidation-metrics">
				<div>
					<span>Monto autorizado</span>
					<strong>Q {money(detail.item.totalCents)}</strong>
				</div>
				<div>
					<span>Gastos con factura</span>
					<strong>Q {money(totals.expenses)}</strong>
				</div>
				<div>
					<span>{totals.employeeDue ? 'A favor del colaborador' : 'Reintegro a TECNASA'}</span>
					<strong>Q {money(totals.employeeDue || Math.max(0, totals.balance))}</strong>
				</div>
				<div>
					<span>{totals.refunded ? 'Pendiente de reintegrar' : 'Reintegro adjunto'}</span>
					<strong>Q {money(totals.refunded ? totals.outstandingRefund : 0)}</strong>
				</div>
			</div>
			<div className="liquidation-actions">
				<p>
					{readOnly
						? admin
							? 'Consulta administrativa · Solo lectura'
							: 'Liquidación finalizada'
						: dirty
							? 'Cambios sin guardar'
							: saved
								? 'Todos los cambios están guardados.'
								: 'Completa tus comprobantes y guarda el borrador.'}
				</p>
				<div>
					{!readOnly && (
						<>
							<button className="secondary-button" disabled={busy} onClick={() => void save('draft')}>
								Guardar borrador
							</button>
							<button
								className="primary-button"
								disabled={busy}
								onClick={() => {
									const issues = validateLiquidation(data, detail.item, detail.snapshot.request, true);
									setError(issues);
									setReview(!issues.length);
								}}
							>
								Finalizar liquidación
							</button>
						</>
					)}
					<button className="secondary-button" disabled={busy || !data.receipts.length} onClick={() => void generate()}>
						{busy ? 'Procesando…' : 'Generar PDF'}
					</button>
				</div>
			</div>
			{error.length > 0 && (
				<div className="workflow-error" role="alert">
					<strong>Revisa la liquidación</strong>
					<ul>
						{error.map((e, i) => (
							<li key={i}>{e}</li>
						))}
					</ul>
				</div>
			)}
			{notice && (
				<p className="workflow-notice" role="status">
					{notice}
				</p>
			)}
			{pdf?.source === data && (
				<div className="liquidation-pdf-result">
					<strong>Tu PDF está listo</strong>
					<a className="secondary-button" href={pdf.url} target="_blank" rel="noopener noreferrer">
						Ver PDF
					</a>
					<a className="primary-button" href={pdf.url} download={pdf.name}>
						Descargar PDF
					</a>
				</div>
			)}
			{review && (
				<div className="liquidation-review">
					<strong>Todo listo para cerrar tu viaje</strong>
					<p>
						Se guardarán {data.receipts.length} comprobantes, Q {money(totals.expenses)} de gastos y Q {money(totals.refunded)} de
						reintegro. La liquidación finalizada quedará disponible para consulta y descarga.
					</p>
					<button className="primary-button" disabled={busy} onClick={() => void save('submitted')}>
						Confirmar y finalizar
					</button>
					<button className="secondary-button" disabled={busy} onClick={() => setReview(false)}>
						Seguir revisando
					</button>
				</div>
			)}
			<div className="liquidation-layout">
				<div className="liquidation-form-column">
					<fieldset disabled={busy || readOnly} className="liquidation-fields">
						<div className="liquidation-form-section">
							<h3>Datos de la liquidación</h3>
							<div className="liquidation-field-grid">
								<label>
									Fecha de liquidación
									<input
										type="date"
										value={data.date}
										onChange={(e) => {
											setData((d) => ({ ...d, date: e.target.value }));
											setReview(false);
										}}
									/>
								</label>
								<label>
									Departamento
									<input
										maxLength={100}
										value={data.department}
										onChange={(e) => {
											setData((d) => ({ ...d, department: e.target.value }));
											setReview(false);
										}}
									/>
								</label>
							</div>
							<label>
								Observaciones <span className="optional">· Opcional</span>
								<textarea
									rows={2}
									maxLength={2000}
									value={data.notes}
									onChange={(e) => {
										setData((d) => ({ ...d, notes: e.target.value }));
										setReview(false);
									}}
									placeholder="Algún detalle que deba conocer administración"
								/>
							</label>
						</div>
						{!readOnly && (
							<div className="liquidation-form-section">
								<h3>Agrega tus comprobantes</h3>
								<p className="field-note">Dos por hoja, en vertical. Puedes subir varias imágenes o pegarlas desde una captura.</p>
								<div className="receipt-kind-picker" aria-label="Tipo de comprobante">
									<button type="button" aria-pressed={kind === 'invoice'} onClick={() => setKind('invoice')}>
										Factura
									</button>
									<button type="button" aria-pressed={kind === 'refund'} onClick={() => setKind('refund')}>
										Reintegro
									</button>
								</div>
								<label className="receipt-upload-zone">
									<span aria-hidden="true">＋</span>
									<strong>{kind === 'invoice' ? 'Subir facturas' : 'Subir reintegro'}</strong>
									<span>PNG, JPG o WebP · También puedes pegar con Ctrl+V o ⌘+V</span>
									<input
										type="file"
										accept="image/png,image/jpeg,image/webp"
										multiple
										aria-label={kind === 'invoice' ? 'Subir facturas' : 'Subir reintegro'}
										onChange={(e) => {
											const files = Array.from(e.currentTarget.files ?? []);
											e.currentTarget.value = '';
											if (files.length) void add(() => files);
										}}
									/>
									<textarea
										rows={1}
										value=""
										onChange={() => {}}
										placeholder="Haz clic y pega aquí tu comprobante"
										aria-label="Pegar comprobante"
										onPaste={(e) => {
											e.preventDefault();
											const files = pastedImageFiles(e.clipboardData);
											void add(() => files);
										}}
									/>
								</label>
								<button type="button" className="secondary-button" onClick={() => void add(() => readClipboardImages(navigator.clipboard))}>
									Pegar imagen
								</button>
								<p className="field-note">El reintegro registra dinero devuelto a TECNASA y no se suma a tus gastos.</p>
							</div>
						)}
						{data.receipts.map((r, i) => (
							<ReceiptCard
								key={r.id}
								receipt={r}
								index={i}
								departure={detail.item.departureDate}
								returnDate={detail.item.returnDate}
								disabled={busy || readOnly}
								update={(patch) => update(r.id, patch)}
								process={(operation) => void processImage(r.id, operation)}
								remove={() => {
									setData((d) => ({ ...d, receipts: d.receipts.filter((x) => x.id !== r.id) }));
									setReview(false);
								}}
							/>
						))}
						{!data.receipts.length && (
							<div className="liquidation-empty">
								<p>
									{admin
										? 'Esta solicitud todavía no tiene comprobantes de liquidación.'
										: 'Agrega tu primera factura para comenzar. El resumen se calculará automáticamente.'}
								</p>
							</div>
						)}
					</fieldset>
				</div>
				<aside className="liquidation-preview" aria-label="Vista previa de liquidación">
					<div className="preview-toolbar">
						<div>
							<span>VISTA PREVIA DEL PDF</span>
							<strong>
								{Math.max(1, Math.ceil(data.receipts.filter((r) => r.kind === 'invoice').length / 15)) +
									Math.ceil(data.receipts.length / 2)}{' '}
								páginas
							</strong>
						</div>
						<span>Liquidación + comprobantes</span>
					</div>
					<div className="print-area" ref={printArea}>
						<LiquidationPages detail={detail} data={data} />
					</div>
				</aside>
			</div>
		</section>
	);
}
function ReceiptCard({
	receipt: r,
	index,
	departure,
	returnDate,
	disabled,
	update,
	process,
	remove,
}: {
	receipt: Receipt;
	index: number;
	departure: string;
	returnDate: string;
	disabled: boolean;
	update: (patch: Partial<Receipt>) => void;
	process: (operation: () => Promise<Partial<Receipt>>) => void;
	remove: () => void;
}) {
	const imageDialog = useRef<HTMLDialogElement>(null);
	return (
		<article className="receipt-card">
			{createPortal(
				<dialog
					ref={imageDialog}
					className="receipt-lightbox"
					aria-label={`Comprobante ${index + 1} ampliado`}
					onClick={(event) => {
						if (event.target === event.currentTarget) imageDialog.current?.close();
					}}
				>
					<div>
						<button type="button" className="secondary-button" onClick={() => imageDialog.current?.close()}>
							Cerrar imagen
						</button>
						<img src={r.src} alt={`Comprobante ${index + 1} ampliado`} />
					</div>
				</dialog>,
				document.body,
			)}
			<div className="receipt-card-heading">
				<h3>
					{r.kind === 'refund' ? 'Reintegro' : 'Factura'} {index + 1}
				</h3>
				<button
					type="button"
					className="receipt-remove"
					disabled={disabled}
					onClick={remove}
					aria-label={`Eliminar comprobante ${index + 1}`}
				>
					Eliminar
				</button>
			</div>
			<div className="receipt-card-body">
				<div className="receipt-image-column">
					<a
						href={`#comprobante-${r.id}`}
						onClick={(event) => {
							event.preventDefault();
							imageDialog.current?.showModal();
						}}
						aria-label={`Ver comprobante ${index + 1} completo`}
					>
						<img src={r.src} alt={`Comprobante ${index + 1}: ${r.name}`} />
					</a>
					{r.croppedSrc && (
						<label className="receipt-toggle">
							<input
								type="checkbox"
								checked={r.src === r.croppedSrc}
								disabled={disabled}
								onChange={(e) => update({ src: e.target.checked ? r.croppedSrc : r.originalSrc })}
							/>
							Recortar márgenes
						</label>
					)}
					<p className="field-note">Toca la imagen para ampliarla.</p>
					{!disabled && <ReceiptAdjuster receipt={r} process={process} />}
				</div>
				<div className="receipt-data-column">
					<label>
						Tipo de comprobante
						<select disabled={disabled} value={r.kind} onChange={(e) => update({ kind: e.target.value as Receipt['kind'] })}>
							<option value="invoice">Factura</option>
							<option value="refund">Reintegro a TECNASA</option>
						</select>
					</label>
					<div className="liquidation-field-grid">
						<label>
							Fecha
							<input
								type="date"
								value={r.date}
								min={r.kind === 'invoice' ? departure : undefined}
								max={r.kind === 'invoice' ? returnDate : undefined}
								onChange={(e) => update({ date: e.target.value })}
							/>
						</label>
						<label>
							Monto (Q)
							<input
								inputMode="decimal"
								maxLength={12}
								value={r.amount}
								placeholder="0.00"
								onChange={(e) => update({ amount: e.target.value })}
							/>
						</label>
					</div>
					{r.kind === 'invoice' ? (
						<>
							<div className="liquidation-field-grid">
								<label>
									Número de serie
									<input maxLength={100} value={r.series} placeholder="Ej. 55CC6BA3" onChange={(e) => update({ series: e.target.value })} />
								</label>
								<label>
									Número de DTE
									<input maxLength={100} value={r.dte} placeholder="Ej. 722812998" onChange={(e) => update({ dte: e.target.value })} />
								</label>
							</div>
							<label>
								NIT
								<input
									maxLength={100}
									value={r.nit}
									placeholder="NIT que figura en la factura"
									onChange={(e) => update({ nit: e.target.value })}
								/>
							</label>
							<label>
								Nombre del proveedor
								<input
									maxLength={240}
									value={r.issuer}
									placeholder="Nombre o razón social"
									onChange={(e) => update({ issuer: e.target.value })}
								/>
							</label>
							<label>
								Concepto
								<input
									maxLength={240}
									value={r.concept}
									list={`liquidation-concepts-${r.id}`}
									onChange={(e) => update({ concept: e.target.value })}
								/>
							</label>
							<datalist id={`liquidation-concepts-${r.id}`}>
								{['Alimentación', 'Combustible', 'Hospedaje', 'Parqueo', 'Insumos', 'Renta de auto', 'Transporte'].map((c) => (
									<option key={c} value={c} />
								))}
							</datalist>
							<details className="receipt-taxes">
								<summary>Detalle de impuestos · Opcional</summary>
								<p className="field-note">Copia estos importes de la factura si corresponde.</p>
								<div className="receipt-tax-grid">
									{(['idp', 'base', 'iva'] as const).map((k) => (
										<label key={k}>
											{k.toUpperCase()} (Q)
											<input
												maxLength={12}
												inputMode="decimal"
												value={r[k]}
												placeholder="0.00"
												onChange={(e) => update({ [k]: e.target.value })}
											/>
										</label>
									))}
								</div>
							</details>
						</>
					) : (
						<>
							<label>
								Referencia del reintegro <span className="optional">· Opcional</span>
								<input
									maxLength={100}
									value={r.dte}
									placeholder="Referencia o autorización bancaria"
									onChange={(e) => update({ dte: e.target.value })}
								/>
							</label>
							<p className="receipt-refund-note">
								Este comprobante respalda la devolución del saldo. Puedes cambiarlo a factura desde el selector.
							</p>
						</>
					)}
				</div>
			</div>
		</article>
	);
}

function ReceiptAdjuster({ receipt, process }: { receipt: Receipt; process: (operation: () => Promise<Partial<Receipt>>) => void }) {
	const [edges, setEdges] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
	const labels = { left: 'Izquierda', right: 'Derecha', top: 'Arriba', bottom: 'Abajo' };
	return (
		<details className="receipt-adjuster">
			<summary>Ajustar imagen</summary>
			<button
				type="button"
				className="secondary-button"
				onClick={() =>
					process(async () => {
						const originalSrc = await rotateReceipt(receipt.originalSrc);
						const croppedSrc = receipt.croppedSrc ? await rotateReceipt(receipt.croppedSrc) : '';
						return { originalSrc, croppedSrc, src: receipt.src === receipt.croppedSrc ? croppedSrc : originalSrc };
					})
				}
			>
				Girar 90°
			</button>
			<p className="field-note">Recorta el fondo y conserva todos los datos de la factura.</p>
			<div className="receipt-crop-preview">
				<img
					src={receipt.originalSrc}
					alt="Vista previa del recorte"
					style={{ clipPath: `inset(${edges.top}% ${edges.right}% ${edges.bottom}% ${edges.left}%)` }}
				/>
			</div>
			{(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
				<label key={k}>
					{labels[k]} · {edges[k]}%
					<input
						type="range"
						min="0"
						max="45"
						value={edges[k]}
						onChange={(e) => setEdges((v) => ({ ...v, [k]: Number(e.target.value) }))}
					/>
				</label>
			))}
			<button type="button" className="secondary-button" onClick={() => process(() => cropReceipt(receipt.originalSrc, edges))}>
				Aplicar recorte
			</button>
		</details>
	);
}
