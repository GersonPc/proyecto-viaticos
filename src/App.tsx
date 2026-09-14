import { useEffect, useState } from 'react';

type ApiStatus = 'comprobando' | 'listo' | 'sin conexión';

export default function App() {
	const [apiStatus, setApiStatus] = useState<ApiStatus>('comprobando');

	useEffect(() => {
		let active = true;
		void fetch('/api/')
			.then((response) => {
				if (!response.ok) throw new Error('API no disponible');
				if (active) setApiStatus('listo');
			})
			.catch(() => {
				if (active) setApiStatus('sin conexión');
			});

		return () => {
			active = false;
		};
	}, []);

	return (
		<main className="starter">
			<p className="eyebrow">PROYECTO VIÁTICOS</p>
			<h1>Entorno de desarrollo listo</h1>
			<p className="intro">
				La base técnica está instalada. El siguiente paso será definir juntos los requisitos antes de construir la aplicación.
			</p>

			<section className="stack" aria-label="Tecnologías instaladas">
				<article>
					<span>01</span>
					<h2>React + TypeScript</h2>
					<p>Interfaz con recarga rápida mediante Vite.</p>
				</article>
				<article>
					<span>02</span>
					<h2>Cloudflare Workers</h2>
					<p>Runtime local equivalente al entorno de despliegue.</p>
				</article>
				<article>
					<span>03</span>
					<h2>Calidad y GitHub</h2>
					<p>Pruebas, lint, formato e integración continua.</p>
				</article>
			</section>

			<div className={`status ${apiStatus === 'listo' ? 'ok' : ''}`} role="status">
				<span aria-hidden="true" /> API del entorno: {apiStatus}
			</div>
		</main>
	);
}
