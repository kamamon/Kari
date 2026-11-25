#!/usr/bin/env python3
"""Validate the generated supplement without modifying any source PNG."""
from pathlib import Path
import json
import hashlib
from collections import Counter
from PIL import Image
import numpy as np

BASE = Path(__file__).resolve().parent
REPO = BASE.parent.parent
SOURCES = [('icons', 'icons_generation.json', 'assets'), ('equipment', 'equipment_manifest.json', 'items'), ('characters-props', 'metadata.json', 'assets'), ('fields', 'fields_generation.json', 'records')]
expected_counts = {'icons': 14, 'equipment': 9, 'characters-props': 10, 'fields': 20}
assets = []
for group, filename, key in SOURCES:
    data = json.loads((BASE/group/filename).read_text())
    assert len(data[key]) == expected_counts[group], (group, len(data[key]))
    for record in data[key]:
        name = record.get('filename') or record.get('file')
        path = BASE/group/name
        with Image.open(path) as im:
            im.load()
            assert im.format == 'PNG'
            stats = {'width': im.width, 'height': im.height, 'mode': im.mode}
            if 'A' in im.getbands():
                alpha = np.asarray(im.getchannel('A'))
                bbox = im.getchannel('A').point(lambda v: 255 if v >= 128 else 0).getbbox()
                assert bbox is not None
                stats['alpha'] = {'min': int(alpha.min()), 'max': int(alpha.max()), 'clear_pixel_fraction': float(np.mean(alpha == 0)), 'main_body_bbox_at_128': list(bbox), 'outer_border_max': int(max(alpha[0,:].max(), alpha[-1,:].max(), alpha[:,0].max(), alpha[:,-1].max()))}
        assets.append({'group': group, 'file': f'{group}/{name}', 'name': record['name'], 'id': record.get('id'), 'kind': record.get('kind', 'field_reference'), 'source': record.get('source', 'public/data/bestiary.json.fields' if group == 'fields' else None), 'spec_notes': record.get('spec_notes', []), 'terrain': record.get('terrain'), 'mood': record.get('mood'), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size, **stats})

files = {x['file'] for x in assets}
actual = {str(p.relative_to(BASE)) for group, _, _ in SOURCES for p in (BASE/group).glob('*.png')}
assert files == actual
assert len(assets) == 53 and len({x['sha256'] for x in assets}) == 53
item_data = json.loads((REPO/'public/data/items.json').read_text())
target_items = {x['id']: x['name'] for key in ('items', 'materials') for x in item_data[key]}
actual_items = {x['id']: x['name'] for x in assets if x['group'] == 'icons'}
assert target_items == actual_items
field_data = json.loads((REPO/'public/data/bestiary.json').read_text())['fields']
field_assets = [x for x in assets if x['group'] == 'fields']
assert [(x['name'], x['terrain']) for x in field_assets] == [(x['name'], x['terrain']) for x in field_data]
assert all(x['mode'] == 'RGBA' and x['alpha']['min'] == 0 for x in assets if x['group'] == 'icons')

manifest = {'schemaVersion': 1, 'title': '霧境の狩人 追加原画53点', 'date': '2026-11-25', 'reference_commit': 'b62f1e6607061bc6afa8895cef3192923915c0a9', 'status': 'generated proposals; not accepted or integrated', 'generator': 'built-in image_gen', 'counts': dict(Counter(x['group'] for x in assets)), 'assets': assets}
(BASE/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
result = {'png_count': len(assets), 'png_bytes': sum(x['bytes'] for x in assets), 'decode_failures': 0, 'duplicate_sha256': 0, 'icon_ids_matched': len(actual_items), 'icon_expected': len(target_items), 'field_names_and_terrain_matched': len(field_assets), 'scope': 'PNG decode, dimensions, alpha metrics, hashes, source label correspondence', 'icons_requested_size': [1024,1024], 'icons_actual_size': sorted({(x['width'],x['height']) for x in assets if x['group'] == 'icons'}), 'icons_alpha_strictly_clean': False, 'game_integration_verified': False, 'iphone_verified': False, 'source_pngs_modified': False, 'npm_ci': {'node':'v24.22.3','command':'npm ci --no-audit --no-fund','result':'success'}}
(BASE/'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result, ensure_ascii=False))
