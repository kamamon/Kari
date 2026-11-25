"""Render every catalog page and make small contact sheets for visual inspection."""
import argparse
import json
import re
from pathlib import Path
import fitz
from PIL import Image, ImageDraw

P = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('pdf', type=Path)
ap.add_argument('--out', type=Path, required=True)
args = ap.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(args.pdf)
data = json.loads((P / 'data/all-equipment.json').read_text())
text_errors = []
for i, s in enumerate(data['series']):
    page_index = 10 + 2 * i
    expected = f'{s["no"]:03}' if s['category'] == 'monster' else f'G{s["no"] - 86:02}'
    for offset, title in [(0, 'EQUIPMENTDESIGN'), (1, 'STATS&CRAFTING')]:
        text = re.sub(r'\s+', '', doc[page_index + offset].get_text())
        if expected + '/' + title not in text:
            text_errors.append({'series': s['no'], 'page': page_index + offset + 1,
                                'expected': expected + '/' + title})
thumbs = []
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
    path = args.out / f'page-{i + 1:03}.png'
    pix.save(path)
    im = Image.open(path).convert('RGB')
    im.thumbnail((190, 269))
    thumbs.append(im.copy())
contact_paths = []
for start in range(0, len(thumbs), 20):
    sheet = Image.new('RGB', (820, 1460), '#d9ddd7')
    draw = ImageDraw.Draw(sheet)
    for j, im in enumerate(thumbs[start:start + 20]):
        x = 10 + (j % 4) * 205
        y = 10 + (j // 4) * 292
        sheet.paste(im, (x, y))
        draw.text((x + 4, y + 273), f'{start + j + 1:03}', fill='#29352b')
    path = args.out / f'contact-{start + 1:03}-{min(start + 20, len(thumbs)):03}.jpg'
    sheet.save(path, quality=88)
    contact_paths.append(str(path))
report = {'pdf': str(args.pdf.resolve()), 'pagesRendered': len(doc),
          'expectedPages': 200, 'pageCountMatches': len(doc) == 200,
          'seriesPageTitleErrors': text_errors, 'contactSheets': contact_paths,
          'visualReview': 'pending; inspect rendered images before marking complete'}
(args.out / 'render-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
