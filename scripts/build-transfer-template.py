"""Extract only fixed content from the reference PDF as a vector SVG template.

Usage: python scripts/build-transfer-template.py path/to/reference.pdf
Requires pdfplumber and pypdf. The original names, account, objective, amounts,
date and handwritten signature are intentionally excluded from the template.
"""
import base64
import sys
from collections import defaultdict
from pathlib import Path
from xml.sax.saxutils import escape

import pdfplumber
from pypdf import PdfReader

source = sys.argv[1]
page = pdfplumber.open(source).pages[0]
reader = PdfReader(source)
fonts = reader.pages[0]['/Resources']['/Font']
styles = []
font_names = {}
for key, ref in fonts.items():
    font = ref.get_object()
    name = str(font['/BaseFont']).lstrip('/')
    family = 'Reference' + str(key).lstrip('/')
    font_names[name] = family
    data = font['/FontDescriptor']['/FontFile2'].get_data()
    encoded = base64.b64encode(data).decode()
    styles.append(f'@font-face{{font-family:{family};src:url(data:font/ttf;base64,{encoded}) format("truetype")}}')

# Keep every heading, currency symbol, and fixed administration entry.
fixed_text = {
    '75', '-', 'Elaborado Por', 'Revisado por', 'Contabilizado por',
    'MICROSISTEMAS', 'Ludwin Cardenas', 'Ariel Yoc',
}
# PDF text blocks are grouped by baseline/font and separated by large gaps.
groups = defaultdict(list)
for c in page.chars:
    groups[(round(c['matrix'][5], 3), c['fontname'], c['size'])].append(c)
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792" viewBox="0 0 612 792">',
       '<title>Plantilla fija de transferencia</title>', '<style>' + ''.join(styles) + '</style>']
for (baseline, font, size), chars in groups.items():
    # Same-line cells may appear out of order in the source stream.
    runs = []
    for c in chars:
        if not runs or abs(c['x0'] - runs[-1][-1]['x1']) > 2:
            runs.append([])
        runs[-1].append(c)
    for run in runs:
        text = ''.join(c['text'] for c in run).strip()
        keep = ('Bold' in font and text and not text.replace('.', '').replace(' ', '').isdigit()) or text in fixed_text or text.startswith('GTQ')
        if not keep:
            continue
        # Character positions retain the reference PDF's exact tracking.
        xs = ' '.join(f'{c["x0"]:.4f}' for c in run)
        value = escape(''.join(c['text'] for c in run))
        svg.append(f'<text x="{xs}" y="{792-baseline:.4f}" font-family="{font_names[font]}" font-size="{size:.4f}" xml:space="preserve">{value}</text>')
for r in page.rects:
    svg.append(f'<rect x="{r["x0"]:.4f}" y="{r["top"]:.4f}" width="{r["width"]:.4f}" height="{r["height"]:.4f}"/>')
logo = next(i for i in reader.pages[0].images if i.name.startswith('Image14'))
encoded_logo = base64.b64encode(logo.data).decode()
svg.append(f'<image x="50.4" y="53.996" width="102.77" height="40.094" preserveAspectRatio="none" href="data:image/png;base64,{encoded_logo}"/>')
svg.append('</svg>')
Path('public/transfer-template.svg').write_text('\n'.join(svg))
