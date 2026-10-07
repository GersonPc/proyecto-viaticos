import { type ClipboardEvent } from 'react';
import { ImageAttachmentError, pastedImageFiles, readClipboardImages } from './imageClipboard';

type Props = {
	disabled: boolean;
	busy: boolean;
	count: number;
	notice: string;
	onAdd: (getFiles: () => Promise<File[]> | File[]) => Promise<void>;
};

export function ImageAttachmentInput({ disabled, busy, count, notice, onAdd }: Props) {
	const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		event.preventDefault();
		if (disabled || busy) return;
		const files = pastedImageFiles(event.clipboardData);
		void onAdd(() => {
			if (!files.length)
				throw new ImageAttachmentError('No hay una imagen en el portapapeles. Copia una captura del mapa y vuelve a pegarla.');
			return files;
		});
	};
	return (
		<div className="image-attachment-input" aria-busy={busy}>
			<label className="image-paste-zone">
				<strong>Pega aquí tu captura</strong>
				<span>Haz clic en la zona y pulsa Ctrl+V o ⌘+V.</span>
				<textarea
					aria-label="Pegar captura del mapa"
					placeholder="Copia una imagen y pégala aquí"
					rows={2}
					value=""
					onChange={() => {}}
					onPaste={paste}
					disabled={disabled || busy}
				/>
			</label>
			<div className="image-attachment-actions">
				<button
					type="button"
					className="secondary-button"
					disabled={disabled || busy}
					onClick={() => void onAdd(() => readClipboardImages(navigator.clipboard))}
				>
					Pegar imagen
				</button>
				<label className="image-file-button secondary-button">
					Elegir archivo
					<input
						type="file"
						aria-label="Elegir imágenes de mapas o cotizaciones"
						accept="image/png,image/jpeg,image/webp"
						multiple
						disabled={disabled || busy}
						onChange={(event) => {
							const files = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = '';
							if (files.length) void onAdd(() => files);
						}}
					/>
				</label>
			</div>
			<p className="field-note" role="status" aria-live="polite">
				{busy
					? 'Cargando imagen…'
					: notice ||
						(count
							? `${count} ${count === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}`
							: 'Puedes pegar capturas o seleccionar varias imágenes.')}
			</p>
		</div>
	);
}
