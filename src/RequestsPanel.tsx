import { useEffect, useRef, useState } from 'react';
import { api, jsonOptions } from './api';
import { formatDate, money, EXPENSE_IDS } from './request';
import { STATUS_LABELS, type RequestStatus, type SubmittedRequest, type RequestList } from './workflow';

type Props = {
	admin?: boolean;
	canManageAdmins?: boolean;
	onEdit: (item: SubmittedRequest) => Promise<void>;
	onLiquidate: (item: SubmittedRequest) => void;
};
const timestamp = (iso: string) =>
	new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
const labels = { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', lodging: 'Hospedaje', fuel: 'Combustible' };

function Administrators() {
	const [people, setPeople] = useState<{ email: string; isOwner: number }[]>([]);
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const load = async () => {
		const data = await api<{ administrators: typeof people }>('/api/admin/administrators');
		setPeople(data.administrators);
	};
	useEffect(() => {
		void api<{ administrators: typeof people }>('/api/admin/administrators')
			.then((d) => setPeople(d.administrators))
			.catch((e: Error) => setError(e.message));
	}, []);
	const change = async (target: string, method: string) => {
		setBusy(true);
		setError('');
		try {
			await api('/api/admin/administrators', jsonOptions(method, { email: target }));
			setEmail('');
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'No se pudo actualizar el acceso.');
		} finally {
			setBusy(false);
		}
	};
	return (
		<details className="administrators">
			<summary>Administradores · Gestionar acceso</summary>
			<p>Los administradores pueden revisar todas las solicitudes. Solo tú puedes gestionar sus permisos.</p>
			<form
				className="review-controls"
				onSubmit={(e) => {
					e.preventDefault();
					void change(email, 'PUT');
				}}
			>
				<label>
					Correo corporativo
					<input
						type="email"
						required
						maxLength={254}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="nombre@tecnasa.com"
						disabled={busy}
					/>
				</label>
				<button className="primary-button" disabled={busy}>
					Agregar administrador
				</button>
			</form>
			{error && <p role="alert">{error}</p>}
			<ul>
				{people.map((person) => (
					<li key={person.email}>
						<span>
							{person.email} {person.isOwner ? '· Principal' : ''}
						</span>
						{!person.isOwner && (
							<button type="button" className="secondary-button" disabled={busy} onClick={() => void change(person.email, 'DELETE')}>
								Quitar acceso
							</button>
						)}
					</li>
				))}
			</ul>
		</details>
	);
}
function RequestDetails({ item }: { item: SubmittedRequest }) {
	const s = item.summary;
	return (
		<details className="request-details">
			<summary>Ver detalle</summary>
			<dl>
				<dt>Objetivo</dt>
				<dd>{s.concept}</dd>
				<dt>Clientes</dt>
				<dd>{s.clients.join(', ') || '—'}</dd>
				<dt>Destinos</dt>
				<dd>{s.destinations.join(', ') || '—'}</dd>
				<dt>Service Tickets</dt>
				<dd>{s.serviceTickets.join(', ') || '—'}</dd>
				<dt>Tickets de proyecto</dt>
				<dd>{s.projectTickets.join(', ') || '—'}</dd>
				<dt>Detalle de insumos</dt>
				<dd>{s.toolsDetail || '—'}</dd>
				<dt>Reparaciones</dt>
				<dd>{s.repairsDetail || '—'}</dd>
				<dt>Último cambio</dt>
				<dd>{timestamp(item.updatedAt)}</dd>
				<dt>Observación</dt>
				<dd>{item.reviewReason || 'Sin observación'}</dd>
			</dl>
			<table className="expense-detail">
				<caption>Desglose de gastos</caption>
				<thead>
					<tr>
						<th scope="col">Gasto</th>
						<th scope="col">Monto</th>
					</tr>
				</thead>
				<tbody>
					{EXPENSE_IDS.map((id) => (
						<tr key={id}>
							<th scope="row">
								{id in labels
									? labels[id as keyof typeof labels]
									: id === 'extra2'
										? 'Insumos'
										: s.extraLabels[id as keyof typeof s.extraLabels] || 'Gasto adicional'}
							</th>
							<td>Q {money(s.expenses.byRow[id])}</td>
						</tr>
					))}
				</tbody>
			</table>
			<table className="expense-detail">
				<caption>Total por día</caption>
				<thead>
					<tr>
						<th scope="col">Fecha</th>
						<th scope="col">Monto</th>
					</tr>
				</thead>
				<tbody>
					{Object.entries(s.expenses.byDate).map(([date, total]) => (
						<tr key={date}>
							<th scope="row">{formatDate(date)}</th>
							<td>Q {money(total)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</details>
	);
}
export function RequestsPanel({ admin = false, canManageAdmins = false, onEdit, onLiquidate }: Props) {
	const [status, setStatus] = useState<RequestStatus | ''>(admin ? 'pending' : '');
	const [name, setName] = useState('');
	const [query, setQuery] = useState('');
	const [reload, setReload] = useState(0);
	const [page, setPage] = useState<RequestList>({ requests: [], nextCursor: null });
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [review, setReview] = useState<{ item: SubmittedRequest; status: 'accepted' | 'rejected' } | null>(null);
	const [reason, setReason] = useState('');
	const generation = useRef(0);
	const decisionRef = useRef(false);
	const endpoint = admin ? '/api/admin/requests' : '/api/requests';
	const url = `${endpoint}?${new URLSearchParams({ ...(status ? { status } : {}), ...(query ? { name: query } : {}) })}`;
	useEffect(() => {
		const controller = new AbortController();
		const gen = ++generation.current;
		void (async () => {
			setLoading(true);
			setError('');
			try {
				const data = await api<RequestList>(url, { signal: controller.signal });
				if (gen === generation.current) setPage(data);
			} catch (e) {
				if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo cargar la tabla.');
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();
		return () => controller.abort();
	}, [url, reload]);
	const more = async () => {
		if (!page.nextCursor || loading || busy) return;
		const gen = generation.current;
		setBusy(true);
		setError('');
		try {
			const data = await api<RequestList>(`${url}&cursor=${encodeURIComponent(page.nextCursor)}`);
			if (gen === generation.current)
				setPage((current) => ({
					requests: [...current.requests, ...data.requests.filter((item) => !current.requests.some((r) => r.id === item.id))],
					nextCursor: data.nextCursor,
				}));
		} catch (e) {
			setError(e instanceof Error ? e.message : 'No se pudo cargar la siguiente página.');
		} finally {
			setBusy(false);
		}
	};
	const decide = async () => {
		if (!review || decisionRef.current) return;
		decisionRef.current = true;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			await api(
				`/api/admin/requests/${review.item.id}/review`,
				jsonOptions('POST', { revision: review.item.revision, status: review.status, reason }),
			);
			setNotice(
				review.status === 'accepted'
					? 'Solicitud aceptada. Ya está en Aceptadas.'
					: 'Solicitud rechazada. El usuario puede corregirla y reenviarla.',
			);
			setReview(null);
			setReload((r) => r + 1);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'No se pudo registrar la decisión.');
		} finally {
			setBusy(false);
			decisionRef.current = false;
		}
	};
	const edit = async (item: SubmittedRequest) => {
		setBusy(true);
		setError('');
		try {
			await onEdit(item);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'No se pudo abrir la solicitud.');
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="requests-panel" aria-label={admin ? 'Administración de solicitudes' : 'Mis solicitudes'}>
			<div className="requests-heading">
				<div>
					<p className="eyebrow">{admin ? 'ADMINISTRACIÓN' : 'SEGUIMIENTO'}</p>
					<h2>{admin ? 'Solicitudes de viáticos' : 'Mis solicitudes'}</h2>
					<p>
						{admin
							? 'Revisa las solicitudes más recientes y registra tu decisión.'
							: 'Consulta el estado y corrige las solicitudes rechazadas.'}
					</p>
				</div>
				<button type="button" className="secondary-button" disabled={loading || busy} onClick={() => setReload((r) => r + 1)}>
					Actualizar
				</button>
			</div>
			<div className="request-tabs" aria-label="Filtrar solicitudes">
				{(!admin ? [''] : []).concat(['pending', 'accepted', 'rejected']).map((s) => (
					<button
						type="button"
						key={s}
						aria-pressed={status === s}
						disabled={busy}
						onClick={() => {
							setStatus(s as RequestStatus | '');
							setReview(null);
						}}
						className={status === s ? 'primary-button' : 'secondary-button'}
					>
						{s ? `${STATUS_LABELS[s as RequestStatus]}s` : 'Todas'}
					</button>
				))}
			</div>
			<form
				className="requests-filters"
				onSubmit={(e) => {
					e.preventDefault();
					setQuery(name.trim());
				}}
			>
				<label>
					Filtrar por nombre
					<input
						value={name}
						maxLength={100}
						onChange={(e) => setName(e.target.value)}
						placeholder="Nombre del colaborador"
						disabled={busy}
					/>
				</label>
				<button className="secondary-button" disabled={busy}>
					Buscar
				</button>
				<span>
					Más recientes primero · {page.requests.length} {page.requests.length === 1 ? 'solicitud cargada' : 'solicitudes cargadas'}
				</span>
			</form>
			{notice && (
				<p role="status" className="workflow-notice">
					{notice}
				</p>
			)}
			{error && (
				<p role="alert" className="workflow-error">
					{error}
				</p>
			)}
			{review && (
				<section className="review-box" aria-label="Confirmar decisión">
					<h3>
						{review.status === 'accepted' ? 'Aceptar' : 'Rechazar'} solicitud de {review.item.name}
					</h3>
					<p>
						{formatDate(review.item.requestDate)} · Q {money(review.item.totalCents)}
					</p>
					<label>
						Observación (opcional)
						<textarea
							maxLength={2000}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							disabled={busy}
							placeholder={review.status === 'rejected' ? 'Qué debe corregir el usuario' : 'Observación de la revisión'}
						/>
					</label>
					<div className="review-controls">
						<button type="button" className="primary-button" disabled={busy} onClick={() => void decide()}>
							{busy ? 'Guardando…' : 'Confirmar decisión'}
						</button>
						<button type="button" className="secondary-button" disabled={busy} onClick={() => setReview(null)}>
							Cancelar
						</button>
					</div>
				</section>
			)}
			<div
				className="requests-grid"
				tabIndex={0}
				role="region"
				aria-label="Tabla de solicitudes con desplazamiento horizontal"
				aria-busy={loading}
			>
				<table>
					<caption>
						{admin ? 'Solicitudes recibidas por administración' : 'Solicitudes enviadas'} · {status ? `${STATUS_LABELS[status]}s` : 'Todas'}
					</caption>
					<thead>
						<tr>
							{[
								'Nombre',
								'Fecha solicitud',
								'Entrada a administración',
								'Salida del viaje',
								'Regreso del viaje',
								'Clientes / Destinos',
								'Tickets',
								'Kilómetros',
								'Total solicitado',
								'Estado',
								'Detalle',
								'Acciones',
							].map((h) => (
								<th scope="col" key={h}>
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td colSpan={12}>Cargando solicitudes…</td>
							</tr>
						) : page.requests.length === 0 ? (
							<tr>
								<td colSpan={12}>No hay solicitudes en este apartado.</td>
							</tr>
						) : (
							page.requests.map((item) => (
								<tr key={item.id}>
									<th scope="row">{item.name}</th>
									<td>{formatDate(item.requestDate)}</td>
									<td>{timestamp(item.submittedAt)}</td>
									<td>{formatDate(item.departureDate)}</td>
									<td>{formatDate(item.returnDate)}</td>
									<td>
										<details>
											<summary>
												{item.summary.clients[0] || item.summary.destinations[0] || 'Sin destinos'}
												{item.summary.clients.length + item.summary.destinations.length > 1 ? ' · Ver todos' : ''}
											</summary>
											<p>{item.summary.clients.join(', ')}</p>
											<p>{item.summary.destinations.join(', ')}</p>
										</details>
									</td>
									<td>
										<details>
											<summary>{item.summary.serviceTickets[0] || item.summary.projectTickets[0] || 'Sin tickets'}</summary>
											<p>Servicio: {item.summary.serviceTickets.join(', ') || '—'}</p>
											<p>Proyecto: {item.summary.projectTickets.join(', ') || '—'}</p>
										</details>
									</td>
									<td className="numeric">{item.kilometers.toLocaleString('es-GT', { maximumFractionDigits: 2 })} km</td>
									<td className="numeric">Q {money(item.totalCents)}</td>
									<td>
										<span className={`status-chip ${item.status}`}>{STATUS_LABELS[item.status]}</span>
										{item.status === 'rejected' && <p className="rejection-reason">{item.reviewReason || 'Sin observación'}</p>}
									</td>
									<td>
										<RequestDetails item={item} />
									</td>
									<td>
										<div className="row-actions">
											{admin && item.status === 'pending' ? (
												<>
													<button
														type="button"
														className="primary-button"
														disabled={busy}
														onClick={() => {
															setReview({ item, status: 'accepted' });
															setReason('');
														}}
													>
														Aceptar
													</button>
													<button
														type="button"
														className="secondary-button"
														disabled={busy}
														onClick={() => {
															setReview({ item, status: 'rejected' });
															setReason('');
														}}
													>
														Rechazar
													</button>
												</>
											) : !admin && item.status === 'rejected' ? (
												<button type="button" className="secondary-button" disabled={busy} onClick={() => void edit(item)}>
													Editar y reenviar
												</button>
											) : item.status === 'accepted' ? (
												<button type="button" className="primary-button" disabled={busy} onClick={() => onLiquidate(item)}>
													{admin ? 'Ver liquidación' : 'Liquidar solicitud'}
												</button>
											) : (
												<span>—</span>
											)}
										</div>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
			{page.nextCursor && !loading && (
				<button type="button" className="secondary-button load-more" disabled={busy} onClick={() => void more()}>
					{busy ? 'Cargando…' : 'Cargar 50 más'}
				</button>
			)}
			{admin && canManageAdmins && <Administrators />}
		</section>
	);
}
