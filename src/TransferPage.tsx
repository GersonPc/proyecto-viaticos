import { FitText } from './PdfText';
import { transferValues, type RequestForm } from './request';

function objectiveLines(value: string) {
	const words = value.trim().split(/\s+/);
	const lines = [''];
	for (const word of words) {
		if (lines[0].length + word.length > 100 && lines.length === 1) lines.push('');
		const index = lines.length - 1;
		lines[index] += `${lines[index] ? ' ' : ''}${word}`;
	}
	return lines;
}

export function TransferPage({ form }: { form: RequestForm }) {
	const values = transferValues(form);
	return (
		<section className="paper-sheet portrait-sheet transfer-sheet" aria-label="Transferencia">
			<svg
				className="transfer-document"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 612 792"
				role="img"
				aria-label="Solicitud para confección de cheque"
			>
				<image href="/transfer-template.svg" width="612" height="792" />
				<FitText text={values.date} x={378.5} y={131.66} width={270} />
				<FitText text={values.beneficiary} x={378.5} y={142.94} width={270} />
				<FitText text={values.concept} x={243.41} y={154.22} width={163} align="start" />
				<FitText text={values.amount} x={509.54} y={154.22} width={71} align="end" />
				{objectiveLines(values.objective).map((line, index) => (
					<FitText key={index} text={line} x={283.13} y={176.78 + index * 11.28} width={457} size={8.04} font="Arial" />
				))}
				<FitText text={values.requestedBy} x={310.02} y={221.9} width={132} />
				<FitText text={form.account.number} x={122.61} y={277.85} width={139} font="Arial" />
				<FitText text={form.account.type} x={122.61} y={289.13} width={139} />
				<FitText text={form.account.bank} x={310.02} y={277.85} width={132} font="Arial" />
				<FitText text={values.accountHolder} x={310.02} y={289.13} width={132} size={8.04} />
				<FitText text={values.amount} x={509.54} y={277.85} width={71} align="end" />
				<FitText text={values.amount} x={508.51} y={300.89} width={70} align="end" bold />
				{values.signature && (
					<image href={values.signature} x={70.036} y={316.677} width={70.066} height={29.733} preserveAspectRatio="xMidYMid meet" />
				)}
				<FitText text={values.preparedBy} x={122.61} y={368.57} width={139} />
			</svg>
		</section>
	);
}
