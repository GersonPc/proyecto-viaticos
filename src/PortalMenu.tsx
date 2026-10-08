import { useEffect, useRef } from 'react';

type View = 'form' | 'mine' | 'admin' | 'liquidations';
type Props = { view: View; isAdmin: boolean; disabled: boolean; onNavigate: (view: View) => void; onNew: () => void };
const labels: Record<View, string> = {
	form: 'Solicitud',
	mine: 'Mis solicitudes',
	admin: 'Administración',
	liquidations: 'Mis liquidaciones',
};
export function PortalMenu({ view, isAdmin, disabled, onNavigate, onNew }: Props) {
	const menu = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const outside = (event: PointerEvent) => {
			if (event.target instanceof Node && menu.current && !menu.current.contains(event.target)) menu.current.open = false;
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && menu.current?.open) {
				menu.current.open = false;
				menu.current.querySelector<HTMLElement>('summary')?.focus();
			}
		};
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, []);
	const close = () => {
		if (menu.current) menu.current.open = false;
	};
	return (
		<details className="portal-menu" ref={menu}>
			<summary
				className="secondary-button"
				aria-disabled={disabled}
				onClick={(event) => {
					if (disabled) event.preventDefault();
				}}
			>
				<span aria-hidden="true">☰</span> Menú <span className="menu-current">· {labels[view]}</span>
				<span aria-hidden="true">⌄</span>
			</summary>
			<nav className="portal-menu-options" aria-label="Apartados del portal">
				<span className="menu-label">NAVEGACIÓN</span>
				{(['form', 'mine', 'liquidations', ...(isAdmin ? ['admin'] : [])] as View[]).map((item) => (
					<button
						type="button"
						key={item}
						aria-current={view === item ? 'page' : undefined}
						disabled={disabled}
						onClick={() => {
							close();
							onNavigate(item);
						}}
					>
						{labels[item]}
						{view === item && <span aria-hidden="true">✓</span>}
					</button>
				))}
				<button
					type="button"
					className="menu-new"
					disabled={disabled}
					onClick={() => {
						close();
						onNew();
					}}
				>
					<span>Nueva solicitud</span>
					<span aria-hidden="true">＋</span>
				</button>
			</nav>
		</details>
	);
}
