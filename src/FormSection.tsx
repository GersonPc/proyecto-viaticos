import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
	title: string;
	summary: string;
	children: ReactNode;
	complete?: boolean;
	initialOpen?: boolean;
	autoCollapse?: boolean;
	number?: string;
	panel?: boolean;
};
/** Keep completed steps compact, while preserving explicit reopening and multi-selection. */
export function FormSection({
	title,
	summary,
	children,
	complete = false,
	initialOpen,
	autoCollapse = true,
	number,
	panel = false,
}: Props) {
	const element = useRef<HTMLDetailsElement>(null);
	const [state, setState] = useState({ open: initialOpen ?? !complete, settled: complete });
	useEffect(() => {
		if (!autoCollapse || !complete || !state.open || state.settled) return;
		let pointerDown = false;
		const finishOutside = (target: EventTarget | null) => {
			if (target instanceof Node && element.current && !element.current.contains(target)) {
				setState({ open: false, settled: true });
			}
		};
		// Collapse after the destination's click runs, so moving content cannot swallow that click.
		const pointer = () => {
			pointerDown = true;
		};
		const click = (event: MouseEvent) => {
			pointerDown = false;
			finishOutside(event.target);
		};
		const focus = (event: FocusEvent) => {
			if (!pointerDown) finishOutside(event.target);
		};
		const cancel = () => {
			pointerDown = false;
		};
		document.addEventListener('pointerdown', pointer, true);
		document.addEventListener('click', click);
		document.addEventListener('focusin', focus);
		document.addEventListener('pointercancel', cancel);
		return () => {
			document.removeEventListener('pointerdown', pointer, true);
			document.removeEventListener('click', click);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('pointercancel', cancel);
		};
	}, [autoCollapse, complete, state.open, state.settled]);
	return (
		<details
			ref={element}
			className={`form-disclosure ${panel ? 'form-panel' : 'form-step'}`}
			open={state.open}
			onToggle={(event) => {
				if (event.target !== event.currentTarget) return;
				const open = event.currentTarget.open;
				setState((current) => (current.open === open ? current : { open, settled: complete }));
			}}
			onChangeCapture={() => setState((current) => (current.settled ? { ...current, settled: false } : current))}
		>
			<summary className="form-disclosure-heading">
				{number && <span className="step-number">{number}</span>}
				<span className="form-disclosure-copy">
					<span className="form-disclosure-title">{title}</span>
					<span className="form-disclosure-summary">{summary}</span>
				</span>
				{complete && (
					<span className="step-complete" aria-label="Completo">
						✓
					</span>
				)}
				<span className="disclosure-chevron" aria-hidden="true">
					⌄
				</span>
			</summary>
			<div className="form-disclosure-content">
				{children}
				<button
					type="button"
					className="section-done"
					onClick={() => {
						element.current?.querySelector<HTMLElement>(':scope > summary')?.focus();
						setState({ open: false, settled: complete });
					}}
				>
					{complete ? 'Listo, contraer' : 'Contraer sección'} <span aria-hidden="true">↑</span>
				</button>
			</div>
		</details>
	);
}
