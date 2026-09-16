import { useId, useState, type Dispatch, type SetStateAction } from 'react';
import {
	EXTRA_IDS,
	expenseCents,
	expenseRows,
	formatDate,
	isMeal,
	MEAL_RATES,
	totalKilometers,
	kilometerCost,
	money,
	totalsForDates,
	travelDays,
	tripDates,
	type RequestData,
	type RequestForm,
} from './request';

function TagInput({
	label,
	values,
	onChange,
	placeholder,
}: {
	label: string;
	values: string[];
	onChange: (values: string[]) => void;
	placeholder: string;
}) {
	const id = useId();
	const [draft, setDraft] = useState('');
	const commit = () => {
		const tags = draft
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
		if (tags.length) onChange([...new Set([...values, ...tags])]);
		setDraft('');
	};
	return (
		<div className="tag-field full-width">
			<label htmlFor={id}>{label}</label>
			<div className="tag-list" aria-label={`${label} agregados`}>
				{values.map((value) => (
					<span className="tag" key={value}>
						{value}
						<button
							type="button"
							aria-label={`Quitar ${value} de ${label}`}
							onClick={() => onChange(values.filter((tag) => tag !== value))}
						>
							×
						</button>
					</span>
				))}
			</div>
			<div className="tag-entry">
				<input
					id={id}
					value={draft}
					maxLength={240}
					placeholder={placeholder}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === ',')) {
							event.preventDefault();
							commit();
						}
					}}
				/>
				<button type="button" className="secondary-button" onClick={commit} aria-label={`Agregar a ${label}`}>
					Agregar
				</button>
			</div>
			<small>Agrega con Enter o coma. Puedes quitar cada etiqueta con ×.</small>
		</div>
	);
}

export function RequestFields({ form, setForm }: { form: RequestForm; setForm: Dispatch<SetStateAction<RequestForm>> }) {
	const request = form.request;
	const [chosenDate, setChosenDate] = useState('');
	const dates = tripDates(request);
	const activeDate = dates.includes(chosenDate) ? chosenDate : (dates[0] ?? '');
	const days = travelDays(request);
	const totals = totalsForDates(request);
	const rows = expenseRows(request);
	const update = <Key extends keyof RequestData>(key: Key, value: RequestData[Key]) =>
		setForm((current) => ({ ...current, request: { ...current.request, [key]: value } }));
	return (
		<section className="form-panel">
			<div className="section-heading">
				<span>02</span>
				<div>
					<h2>Solicitud</h2>
					<p>Fechas, recorrido y gastos del viaje.</p>
				</div>
			</div>
			<div className="field-grid">
				<label>
					<span>
						Fecha de solicitud <em>*</em>
					</span>
					<input type="date" value={request.date} onChange={(event) => update('date', event.target.value)} />
				</label>
				<label>
					<span>Monto solicitado (GTQ)</span>
					<input readOnly value={money(totals.grandTotal)} />
					<small>Suma automática de todos los gastos.</small>
				</label>
				<label>
					<span>
						Fecha de salida <em>*</em>
					</span>
					<input type="date" value={request.departureDate} onChange={(event) => update('departureDate', event.target.value)} />
				</label>
				<label>
					<span>
						Fecha de regreso <em>*</em>
					</span>
					<input
						type="date"
						min={request.departureDate || undefined}
						value={request.returnDate}
						onChange={(event) => update('returnDate', event.target.value)}
					/>
				</label>
				<div className="calculation-card full-width">
					<span>Días de viaje</span>
					<output aria-live="polite">{days || '—'}</output>
					<small>Incluye el día de salida y el de regreso. La fecha de solicitud es independiente.</small>
				</div>
				<label>
					<span>Nombre (desde Transferencia)</span>
					<input readOnly value={form.person.name} placeholder="Completa el beneficiario" />
				</label>
				<label>
					<span>Cargo</span>
					<input readOnly value="Microsistemas" />
				</label>
				<TagInput
					label="Destinos"
					values={request.destinations}
					onChange={(values) => update('destinations', values)}
					placeholder="Ej. Banco G&T Continental"
				/>
				<label>
					<span>Cantidad de KMS totales</span>
					<input readOnly value={totalKilometers(request)} />
					<small>Suma de los kilómetros de las imágenes en Mapa-Cotización.</small>
				</label>
				<div className="calculation-card">
					<span>Recorrido × Q1.30/km</span>
					<output aria-live="polite">Q{money(kilometerCost(request))}</output>
				</div>
				<TagInput
					label="Service Tickets"
					values={request.serviceTickets}
					onChange={(values) => update('serviceTickets', values)}
					placeholder="Número de Service Ticket"
				/>
				<TagInput
					label="Tickets de proyecto"
					values={request.projectTickets}
					onChange={(values) => update('projectTickets', values)}
					placeholder="Número de ticket de proyecto"
				/>
				<label className="full-width">
					<span>Objetivo del viaje (específico)</span>
					<input
						maxLength={200}
						value={request.concept}
						onChange={(event) => update('concept', event.target.value)}
						placeholder="Ej. Mantenimientos programados GyT - Chimaltenango"
					/>
				</label>
				<label className="full-width">
					<span>
						Detalle del objetivo / nombre completo del ticket <em>*</em>
					</span>
					<textarea
						rows={3}
						maxLength={220}
						value={request.objective}
						onChange={(event) => update('objective', event.target.value)}
						placeholder="Project Ticket #… - Serie…"
					/>
					<small>Se repite debajo de Objetivo en Transferencia.</small>
				</label>
			</div>
			<div className="expense-section">
				<h3>Gastos por día</h3>
				<p className="field-note">
					Marca las comidas de cada día: desayuno Q50, almuerzo Q75 y cena Q75. Hospedaje y los cuatro gastos extra se ingresan manualmente.
				</p>
				<p className="field-note">
					El combustible se calcula con las imágenes de Mapa-Cotización y se asigna a la fecha de cada recorrido.
				</p>
				{dates.length > 0 ? (
					<>
						<label className="expense-day">
							<span>Día que estás llenando</span>
							<select value={activeDate} onChange={(event) => setChosenDate(event.target.value)}>
								{dates.map((date) => (
									<option key={date} value={date}>
										{formatDate(date, true)}
									</option>
								))}
							</select>
						</label>
						<div className="expense-input-grid">
							<span className="expense-column-heading">Clasificación de gastos</span>
							<span className="expense-column-heading">Monto (GTQ)</span>
							{rows.map((row, index) => {
								const automatic = row.id === 'fuel';
								const meal = isMeal(row.id) ? row.id : null;
								const value = automatic
									? (expenseCents(request, activeDate, row.id) / 100).toFixed(2)
									: (request.expenses[activeDate]?.[row.id] ?? '');
								return (
									<div className="expense-input-row" key={row.id}>
										{index < 5 ? (
											<span>{row.label}</span>
										) : (
											<input
												aria-label={`Nombre del gasto extra ${index - 4}`}
												value={row.label}
												maxLength={50}
												placeholder={`Gasto extra ${index - 4}`}
												onChange={(event) => {
													const id = EXTRA_IDS[index - 5];
													setForm((current) => ({
														...current,
														request: { ...current.request, extraLabels: { ...current.request.extraLabels, [id]: event.target.value } },
													}));
												}}
											/>
										)}
										{meal ? (
											<label className="meal-choice">
												<input
													type="checkbox"
													role="switch"
													aria-label={row.label}
													checked={Boolean(request.meals[activeDate]?.[meal])}
													onChange={(event) => {
														const enabled = event.target.checked;
														setForm((current) => ({
															...current,
															request: {
																...current.request,
																meals: {
																	...current.request.meals,
																	[activeDate]: { ...current.request.meals[activeDate], [meal]: enabled },
																},
															},
														}));
													}}
												/>
												<span className="meal-switch" aria-hidden="true" />
												<span className="meal-amount">Q{money(request.meals[activeDate]?.[meal] ? MEAL_RATES[meal] : 0)}</span>
											</label>
										) : (
											<input
												aria-label={`${row.label || `Gasto extra ${index - 4}`} (GTQ)`}
												type="number"
												min="0"
												step="0.01"
												readOnly={automatic}
												value={value}
												placeholder="0.00"
												onChange={(event) =>
													setForm((current) => ({
														...current,
														request: {
															...current.request,
															expenses: {
																...current.request.expenses,
																[activeDate]: { ...current.request.expenses[activeDate], [row.id]: event.target.value },
															},
														},
													}))
												}
											/>
										)}
									</div>
								);
							})}
						</div>
						<div className="calculation-card day-total">
							<span>Total del día</span>
							<output aria-live="polite">Q{money(totals.byDate[activeDate] ?? 0)}</output>
						</div>
						<p className="field-note">
							Los nombres de los extras se comparten entre los días. Solo se suman los gastos dentro de las fechas del viaje.
						</p>
					</>
				) : (
					<p className="empty-expenses">Selecciona fechas de salida y regreso válidas para llenar los gastos.</p>
				)}
				<div className="calculation-card trip-total">
					<span>Gastos totales del viaje</span>
					<output aria-live="polite">Q{money(totals.grandTotal)}</output>
					<small>Se actualiza también en Transferencia.</small>
				</div>
			</div>
			<details className="request-detail-fields">
				<summary>Herramientas, materiales y reparaciones</summary>
				<div className="field-grid">
					<label className="full-width">
						<span>Detalle de herramientas y materiales</span>
						<textarea
							rows={2}
							maxLength={300}
							value={request.toolsDetail}
							onChange={(event) => update('toolsDetail', event.target.value)}
						/>
					</label>
					<label className="full-width">
						<span>Detalle de reparaciones</span>
						<textarea
							rows={2}
							maxLength={300}
							value={request.repairsDetail}
							onChange={(event) => update('repairsDetail', event.target.value)}
						/>
					</label>
				</div>
			</details>
		</section>
	);
}
