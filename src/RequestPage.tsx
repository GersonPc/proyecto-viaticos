import { FitText } from './PdfText';
import {
	expenseCents,
	expenseRows,
	formatDate,
	kilometerCost,
	totalKilometers,
	money,
	requestPages,
	shortDate,
	totalsForDates,
	travelDays,
	type DayColumn,
	type RequestForm,
} from './request';

const columnEdges = [164.18, 204.62, 245.55, 286.49, 327.41, 367.49, 410.09, 451.63, 494.71, 537.31, 578.83, 619.78, 661.3];
const rowBaselines = [170.66, 178.22, 185.78, 193.13, 200.21, 207.17, 214.01, 221.21, 228.89];

function TextLines({
	value,
	x,
	y,
	width,
	limit = 72,
	size = 6.36,
}: {
	value: string;
	x: number;
	y: number;
	width: number;
	limit?: number;
	size?: number;
}) {
	const lines = [''];
	for (const word of value.trim().split(/\s+/)) {
		if (lines.length === 1 && lines[0].length > 0 && lines[0].length + word.length > limit) lines.push('');
		const index = lines.length - 1;
		lines[index] += `${lines[index] ? ' ' : ''}${word}`;
	}
	return lines.map((text, index) => <FitText key={index} text={text} x={x} y={y + index * 6.8} width={width} size={size} font="Arial" />);
}

function RequestPage({
	form,
	columns,
	pageNumber,
	pageCount,
}: {
	form: RequestForm;
	columns: DayColumn[];
	pageNumber: number;
	pageCount: number;
}) {
	const request = form.request;
	const dates = columns.filter((column) => column.active).map((column) => column.date);
	const totals = totalsForDates(request, dates);
	const total = totalsForDates(request).grandTotal;
	const rows = expenseRows(request);
	const days = travelDays(request);
	return (
		<section className="paper-sheet landscape-sheet request-sheet" aria-label={`Solicitud de gastos de viaje, página ${pageNumber}`}>
			<svg
				className="request-document"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 792 612"
				role="img"
				aria-label="Solicitud de gastos de viaje"
			>
				<image href="/request-template.svg" width="792" height="612" />
				<FitText text={`GTQ ${money(total)}`} x={245.55} y={85.58} width={77} size={8.52} font="Calibri" bold />
				<FitText text={days ? days.toFixed(1) : ''} x={347.45} y={84.86} width={35} size={6.36} font="Arial" bold />
				<FitText text={formatDate(request.departureDate)} x={494.53} y={84.86} width={81} size={6.36} font="Arial" bold />
				<FitText text={formatDate(request.returnDate)} x={698.14} y={84.86} width={69} size={6.36} font="Arial" bold />
				<FitText text={form.person.name} x={92.424} y={96.5} width={232} size={6.36} font="Arial" align="start" />
				<FitText text={request.destinations.join(', ')} x={368.93} y={96.5} width={363} size={6.36} font="Arial" align="start" />
				<FitText text={String(totalKilometers(request))} x={430.86} y={104.66} width={37} size={5.88} font="Arial" bold />
				<FitText text={`Q${money(kilometerCost(request))}`} x={636.2} y={104.54} width={190} size={5.28} font="Arial" bold />
				<TextLines value={request.serviceTickets.join(', ')} x={431.1} y={112.1} width={122} limit={40} />
				<TextLines value={request.projectTickets.join(', ')} x={636.2} y={111.62} width={192} limit={60} />
				<FitText text={request.concept} x={449.56} y={127.34} width={565} size={7.44} font="Arial" />
				<FitText text={request.clients.join('; ')} x={449.56} y={135.02} width={565} size={5.88} font="Arial" />
				{columns.map((column, index) => {
					const center = (columnEdges[index] + columnEdges[index + 1]) / 2;
					const width = columnEdges[index + 1] - columnEdges[index] - 3;
					return (
						<g key={column.date} data-date={column.date}>
							<FitText
								text={column.weekday === 'DOMINGO' && !column.active ? '' : column.weekday}
								x={center}
								y={149.66}
								width={width}
								size={5.28}
								font="Arial"
							/>
							<FitText text={column.active ? shortDate(column.date) : ''} x={center} y={163.58} width={width} size={5.28} font="Arial" />
							{rows.map((row, rowIndex) => {
								const cents = column.active ? expenseCents(request, column.date, row.id) : 0;
								return (
									<FitText
										key={row.id}
										text={cents ? `Q${money(cents)}` : ''}
										x={center}
										y={rowBaselines[rowIndex] + 0.36}
										width={width}
										size={5.28}
										font="Arial"
									/>
								);
							})}
							<FitText
								text={`GTQ ${money(totals.byDate[column.date] ?? 0)}`}
								x={center}
								y={236.33}
								width={width}
								size={5.28}
								font="Arial"
							/>
						</g>
					);
				})}
				{rows.map((row, index) => (
					<g key={row.id}>
						{index >= 5 && (
							<FitText text={row.label} x={92.184} y={rowBaselines[index] + 0.36} width={70} size={5.28} font="Arial" align="start" bold />
						)}
						<FitText text={`GTQ ${money(totals.byRow[row.id])}`} x={698.14} y={rowBaselines[index]} width={69} size={5.28} font="Arial" />
					</g>
				))}
				<FitText text={`GTQ ${money(total)}`} x={698.14} y={248.81} width={69} size={7.44} font="Calibri" bold />
				<FitText text={request.toolsDetail} x={166} y={252.89} width={326} size={5.88} font="Arial" align="start" />
				<FitText text={request.repairsDetail} x={166} y={260.45} width={326} size={5.88} font="Arial" align="start" />
				<FitText text={formatDate(request.date, true)} x={127.81} y={289.37} width={151} size={6.36} font="Arial" />
				{form.person.signature && (
					<image href={form.person.signature} x={315.82} y={264.587} width={58.168} height={24.343} preserveAspectRatio="xMidYMid meet" />
				)}
				{pageCount > 1 && (
					<FitText
						text={`Detalle ${pageNumber} de ${pageCount} · Subtotal de esta hoja: GTQ ${money(totals.grandTotal)} · El monto solicitado corresponde al viaje completo.`}
						x={51}
						y={312}
						width={682}
						size={6}
						font="Arial"
						align="start"
					/>
				)}
			</svg>
		</section>
	);
}
export function RequestPages({ form }: { form: RequestForm }) {
	const pages = requestPages(form.request);
	return pages.map((columns, index) => (
		<RequestPage key={columns[0].date} form={form} columns={columns} pageNumber={index + 1} pageCount={pages.length} />
	));
}
