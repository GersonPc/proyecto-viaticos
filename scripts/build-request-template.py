"""Extract fixed layout from the landscape request reference, without sample data.
Usage: python scripts/build-request-template.py reference.pdf
Requires pdfplumber and pypdf.
"""
import base64
import re
import sys
from collections import defaultdict
from pathlib import Path
from xml.sax.saxutils import escape
import pdfplumber
from pypdf import PdfReader

page = pdfplumber.open(sys.argv[1]).pages[0]
reader = PdfReader(sys.argv[1])
styles, font_names = [], {}
for key, ref in reader.pages[0]['/Resources']['/Font'].items():
    font = ref.get_object()
    name = str(font['/BaseFont']).lstrip('/')
    family = 'Request' + str(key).lstrip('/')
    font_names[name] = family
    data = font['/FontDescriptor']['/FontFile2'].get_data()
    encoded = base64.b64encode(data).decode()
    styles.append(f'@font-face{{font-family:{family};src:url(data:font/ttf;base64,{encoded}) format("truetype")}}')
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="792" height="612" viewBox="0 0 792 612">',
       '<title>Plantilla fija de solicitud de gastos de viaje</title>', '<style>' + ''.join(styles) + '</style>']
for r in page.rects:
    color = r['non_stroking_color']
    if isinstance(color, (int, float)):
        color = [color] * 3
    rgb = ','.join(str(round(c * 255)) for c in color)
    svg.append(f'<rect x="{r["x0"]:.4f}" y="{r["top"]:.4f}" width="{r["width"]:.4f}" height="{r["height"]:.4f}" fill="rgb({rgb})"/>')
groups = defaultdict(list)
for c in page.chars:
    groups[(round(c['matrix'][5], 3), c['fontname'], c['size'])].append(c)
fixed_plain = {'Microsistemas', 'Q1.30', 'Detalle de Herramientas y materiales', 'Detalle de reparaciones'}
for (baseline, font, size), chars in groups.items():
    runs = []
    for c in chars:
        if not runs or abs(c['x0'] - runs[-1][-1]['x1']) > 3:
            runs.append([])
        runs[-1].append(c)
    for run in runs:
        text = ''.join(c['text'] for c in run).strip()
        keep = ('Bold' in font and text and not re.fullmatch(r'[\d/.]+', text) and not text.startswith(('GTQ', 'Q1')) and text not in {'Parqueo', 'Insumos'}) or text in fixed_plain
        if not keep:
            continue
        xs = ' '.join(f'{c["x0"]:.4f}' for c in run)
        value = escape(''.join(c['text'] for c in run))
        svg.append(f'<text x="{xs}" y="{612-baseline:.4f}" font-family="{font_names[font]}" font-size="{size:.4f}" xml:space="preserve">{value}</text>')
logo = next(i for i in reader.pages[0].images if i.name.startswith('Image23'))
encoded = base64.b64encode(logo.data).decode()
svg.append(f'<image x="54.02" y="54.001" width="61.864" height="25.659" preserveAspectRatio="none" href="data:image/png;base64,{encoded}"/>')
svg.append('</svg>')
Path('public/request-template.svg').write_text('\n'.join(svg))
