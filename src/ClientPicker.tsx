import { useId, useState } from 'react';
import clients from './clients.json';

const normalize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('es');

export function ClientPicker({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
	const id = useId();
	const [query, setQuery] = useState('');
	const matches = clients.filter((name) => normalize(name).includes(normalize(query.trim())));
	return (
		<div className="client-picker full-width">
			<span className="client-label" id={`${id}-label`}>
				Clientes
			</span>
			<div className="tag-list" aria-label="Clientes seleccionados">
				{values.map((name) => (
					<span className="tag" key={name}>
						{name}
						<button type="button" aria-label={`Quitar cliente ${name}`} onClick={() => onChange(values.filter((value) => value !== name))}>
							×
						</button>
					</span>
				))}
			</div>
			<details>
				<summary aria-labelledby={`${id}-label ${id}-summary`}>
					<span id={`${id}-summary`}>{values.length ? `${values.length} seleccionados · Buscar o agregar` : 'Seleccionar clientes'}</span>
				</summary>
				<div className="client-dropdown">
					<label htmlFor={`${id}-search`}>Buscar por nombre</label>
					<input
						id={`${id}-search`}
						type="search"
						placeholder="Ej. Garda, Dollarcity o Banco"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') event.preventDefault();
						}}
					/>
					<small role="status">
						{matches.length} {matches.length === 1 ? 'cliente disponible' : 'clientes disponibles'}
					</small>
					<div className="client-options" role="group" aria-label="Lista de clientes">
						{matches.map((name) => (
							<label key={name}>
								<input
									type="checkbox"
									checked={values.includes(name)}
									onChange={(event) => onChange(event.target.checked ? [...values, name] : values.filter((value) => value !== name))}
								/>
								<span>{name}</span>
							</label>
						))}
						{matches.length === 0 && <p>No se encontraron clientes con ese nombre.</p>}
					</div>
				</div>
			</details>
			<small>Puedes seleccionar varios clientes. Se mostrarán en la segunda celda de Objetivo del viaje.</small>
		</div>
	);
}
