import { FitText } from './PdfText';
import { formatDate, shortDate, money, toCents } from './request';
import { liquidationTotals, type LiquidationData } from './liquidation';
import type { RequestDetail } from './workflow';
const ROWS = 15;
const edges = [32, 89, 221, 273, 443, 545, 602, 654, 707, 760];
const headings = ['Fecha', 'Serie / Número DTE', 'NIT', 'Nombre / Proveedor', 'Concepto', 'Valor', 'IDP', 'Base', 'IVA'];
export function LiquidationPages({ detail, data }: { detail: RequestDetail; data: LiquidationData }) {
	const invoices = data.receipts.filter((r) => r.kind === 'invoice');
	const pages = Array.from({ length: Math.max(1, Math.ceil(invoices.length / ROWS)) }, (_, i) => invoices.slice(i * ROWS, (i + 1) * ROWS));
	const totals = liquidationTotals(data, detail.item.totalCents);
	const receipts = Array.from({ length: Math.ceil(data.receipts.length / 2) }, (_, i) => data.receipts.slice(i * 2, i * 2 + 2));
	return (
		<>
			{pages.map((rows, p) => (
				<section className="paper-sheet landscape-sheet liquidation-sheet" key={`summary-${p}`} aria-label={`Liquidación, página ${p + 1}`}>
					<svg viewBox="0 0 792 612" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Liquidación de gastos de viaje">
						<rect width="792" height="612" fill="white" />
						<image href="/tecnasa-logo.png" x="32" y="24" width="100" height="47" preserveAspectRatio="xMidYMid meet" />
						<FitText text="LIQUIDACIÓN DE VIÁTICOS" x={760} y={46} width={490} align="end" size={17} bold font="Arial" />
						<FitText text={`${p + 1} / ${pages.length}`} x={760} y={65} width={60} align="end" size={8} font="Arial" />
						{[
							['Colaborador', detail.item.name],
							['Departamento', data.department],
							['Periodo', `${formatDate(detail.item.departureDate)} al ${formatDate(detail.item.returnDate)}`],
							['Monto autorizado', `Q ${money(detail.item.totalCents)}`],
						].map(([label, value], i) => (
							<g key={label}>
								<FitText text={label} x={32} y={92 + i * 18} width={110} align="start" size={9} font="Arial" />
								<FitText text={value} x={148} y={92 + i * 18} width={330} align="start" size={9} bold font="Arial" />
							</g>
						))}
						<FitText text={`Liquidación: ${formatDate(data.date)}`} x={760} y={92} width={240} align="end" size={9} font="Arial" />
						<FitText
							text={`Tickets: ${[...detail.item.summary.serviceTickets, ...detail.item.summary.projectTickets].join(', ') || '—'}`}
							x={760}
							y={110}
							width={245}
							align="end"
							size={8}
							font="Arial"
						/>
						<FitText
							text={`Clientes: ${detail.item.summary.clients.join(', ') || '—'}`}
							x={760}
							y={128}
							width={245}
							align="end"
							size={8}
							font="Arial"
						/>
						<rect x="32" y="163" width="728" height="26" fill="#eaf4e8" />
						{headings.map((h, i) => (
							<FitText
								key={h}
								text={h}
								x={(edges[i] + edges[i + 1]) / 2}
								y={179}
								width={edges[i + 1] - edges[i] - 8}
								size={8}
								bold
								font="Arial"
							/>
						))}
						{Array.from({ length: ROWS }, (_, i) => {
							const r = rows[i],
								y = 189 + i * 15;
							const cells = r
								? [
										r.date ? shortDate(r.date) : '',
										`${r.series}${r.series && r.dte ? ' / ' : ''}${r.dte}`,
										r.nit,
										r.issuer,
										r.concept,
										r.amount ? money(toCents(r.amount)) : '',
										r.idp,
										r.base,
										r.iva,
									]
								: [];
							return (
								<g key={i}>
									{i % 2 === 0 && <rect x="32" y={y} width="728" height="15" fill="#fafafa" />}
									{cells.map((t, k) => (
										<FitText
											key={k}
											text={t}
											x={k >= 5 ? edges[k + 1] - 4 : (edges[k] + edges[k + 1]) / 2}
											y={y + 10}
											width={edges[k + 1] - edges[k] - 8}
											align={k >= 5 ? 'end' : 'middle'}
											size={7.2}
											font="Arial"
										/>
									))}
								</g>
							);
						})}
						{edges.map((x) => (
							<line key={x} x1={x} x2={x} y1="163" y2="414" stroke="#a4a4a4" strokeWidth="0.5" />
						))}
						{Array.from({ length: ROWS + 1 }, (_, i) => (
							<line key={i} x1="32" x2="760" y1={189 + i * 15} y2={189 + i * 15} stroke="#ccc" strokeWidth="0.5" />
						))}
						<rect x="32" y="414" width="728" height="19" fill="#1d1d1d" />
						<g fill="white">
							<FitText text="TOTAL DE GASTOS" x={48} y={427} width={240} align="start" size={8} bold font="Arial" />
							{[totals.expenses, totals.idp, totals.base, totals.iva].map((v, i) => (
								<FitText
									key={i}
									text={money(v)}
									x={edges[i + 6] - 4}
									y={427}
									width={edges[i + 6] - edges[i + 5] - 8}
									align="end"
									size={8}
									bold
									font="Arial"
								/>
							))}
						</g>
						{[
							['Depositado por TECNASA', detail.item.totalCents],
							['Total de gastos', totals.expenses],
							[
								totals.employeeDue ? 'Saldo a favor del colaborador' : 'Reintegro a TECNASA',
								totals.employeeDue || Math.max(0, totals.balance),
							],
							['Pendiente de reintegrar', totals.outstandingRefund],
						].map(([label, value], i) => (
							<g key={label}>
								{i === 1 && <rect x="475" y={439 + i * 14} width="285" height="14" fill="#eaf4e8" />}
								<FitText text={String(label)} x={480} y={449 + i * 14} width={190} align="start" size={8} bold={i === 1} font="Arial" />
								<FitText
									text={`Q ${money(Number(value))}`}
									x={755}
									y={449 + i * 14}
									width={90}
									align="end"
									size={8}
									bold={i === 1}
									font="Arial"
								/>
							</g>
						))}
						<FitText
							text={data.notes || 'Se anexan los comprobantes que respaldan los gastos y el reintegro.'}
							x={32}
							y={455}
							width={410}
							align="start"
							size={7}
							font="Arial"
						/>
						{detail.snapshot.signature && (
							<image href={detail.snapshot.signature} x="78" y="515" width="150" height="45" preserveAspectRatio="xMidYMid meet" />
						)}
						<line x1="48" x2="260" y1="562" y2="562" stroke="#222" />
						<line x1="530" x2="742" y1="562" y2="562" stroke="#222" />
						<FitText text="Firma del colaborador" x={154} y={575} width={200} size={8} font="Arial" />
						<FitText text="Firma de autorización" x={636} y={575} width={200} size={8} font="Arial" />
					</svg>
				</section>
			))}
			{receipts.map((pair, p) => (
				<section className="paper-sheet liquidation-receipts" key={`receipts-${p}`} aria-label={`Comprobantes, página ${p + 1}`}>
					<svg viewBox="0 0 612 792" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dos comprobantes en vertical">
						<rect width="612" height="792" fill="white" />
						{pair.map((r, i) => (
							<image key={r.id} href={r.src} x={30 + i * 282} y="30" width="270" height="732" preserveAspectRatio="xMidYMid meet" />
						))}
					</svg>
				</section>
			))}
		</>
	);
}
