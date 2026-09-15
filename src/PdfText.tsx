import { useLayoutEffect, useRef } from 'react';

/** Coordinates are PDF points (Letter: 612 × 792), shared by preview and print. */
export function FitText({
	text,
	x,
	y,
	width,
	size = 8.76,
	align = 'middle',
	bold = false,
	font = 'Verdana',
}: {
	text: string;
	x: number;
	y: number;
	width: number;
	size?: number;
	align?: 'start' | 'middle' | 'end';
	bold?: boolean;
	font?: string;
}) {
	const ref = useRef<SVGTextElement>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.setAttribute('font-size', String(size));
		const length = element.getComputedTextLength();
		if (length > width) element.setAttribute('font-size', String((size * width) / length));
	}, [text, width, size]);
	return (
		<text ref={ref} x={x} y={y} textAnchor={align} fontFamily={`${font}, Arial, sans-serif`} fontSize={size} fontWeight={bold ? 700 : 400}>
			{text}
		</text>
	);
}
