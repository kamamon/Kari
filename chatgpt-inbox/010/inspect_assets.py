#!/usr/bin/env python3
"""Measure the submitted original PNGs; never modify image pixels.

Dependencies: Pillow and NumPy. Run from any working directory.
The records distinguish requested dimensions from measured silhouette dimensions.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

BASE = Path(__file__).resolve().parent
ALPHA_THRESHOLD = 128
TAGS = set('moss grass strata columns vein crystal cracked rubble flat tall pebbles overhang exit_left exit_right'.split())


def read_json(name):
    return json.loads((BASE / name).read_text(encoding='utf-8'))


def write_json(name, data):
    (BASE / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def r4(value):
    return round(float(value), 4)


def difference_percent(a, b):
    return r4(abs(a - b) / ((a + b) / 2) * 100) if a + b else 0.0


def load_png(filename):
    path = BASE / filename
    with Image.open(path) as im:
        im.load()
        mode = im.mode
        pixels = np.asarray(im.convert('RGBA'))
        width, height = im.size
    alpha = pixels[:, :, 3]
    body = alpha >= ALPHA_THRESHOLD
    rgb = pixels[:, :, :3].astype(np.float64)
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722])
    result = {
        'filename': filename, 'width_px': width, 'height_px': height,
        'mode': mode, 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'has_alpha_channel': mode in ('RGBA', 'LA'),
        'alpha_range': [int(alpha.min()), int(alpha.max())],
        'alpha_zero_fraction': r4(np.mean(alpha == 0)),
        'alpha_body_threshold': ALPHA_THRESHOLD,
        'body_bbox_exclusive_px': bbox(body),
        'body_luminance_mean_rec709': r4(luminance[body].mean()),
        'body_luminance_std_rec709': r4(luminance[body].std()),
    }
    return result, alpha, body, luminance


def measure_rock(record):
    filename = record.get('filename', record.get('file'))
    result, alpha, body, _ = load_png(filename)
    width, height = result['width_px'], result['height_px']
    assert width % 3 == 0, f'{filename}: three equal cells not possible'
    cell = width // 3
    meters = {'S': 2, 'M': 4, 'L': 8}[record['size']]
    ppm = cell / meters
    views = {}
    for index, name in enumerate(('front', 'right', 'top')):
        sub = body[:, index * cell:(index + 1) * cell]
        bounds = bbox(sub)
        assert bounds, f'{filename}: empty {name} view'
        x0, y0, x1, y1 = bounds
        views[name] = {
            'bbox_exclusive_px_in_cell': bounds,
            'width_m': r4((x1 - x0) / ppm),
            'height_m': r4((y1 - y0) / ppm),
            'horizontal_center_error_percent_of_cell': r4(((x0 + x1) / 2 - cell / 2) / cell * 100),
            'touches_cell_border': x0 == 0 or x1 == cell or y0 == 0 or y1 == height,
        }
        if index < 2:
            views[name]['body_bottom_y_normalized_to_512'] = r4((y1 - 1) * 512 / height)
            views[name]['bottom_delta_from_ground_normalized_px'] = r4((y1 - 1) * 512 / height - 384)
            cut = int(np.floor(392 * height / 512)) + 1
            views[name]['body_pixels_below_soil_allowance'] = int(sub[cut:, :].sum())
            views[name]['any_alpha_pixels_below_soil_allowance'] = int(np.count_nonzero(alpha[cut:, index * cell:(index + 1) * cell]))
    front, right, top = views['front'], views['right'], views['top']
    consistency = {
        'front_vs_top_width_percent': difference_percent(front['width_m'], top['width_m']),
        'right_width_vs_top_depth_percent': difference_percent(right['width_m'], top['height_m']),
        'front_vs_right_height_percent': difference_percent(front['height_m'], right['height_m']),
    }
    measured = {'width': front['width_m'], 'depth': top['height_m'], 'height': front['height_m']}
    target = record['spec_target']['size_m']
    target_error = {k: r4((measured[k] - target[k]) / target[k] * 100) for k in measured}
    result.update({
        'id': record['id'], 'name': record['name'], 'group': 'rocks',
        'size': record['size'], 'tags': record['tags'],
        'measurement_scale': {'cell_width_px': cell, 'cell_span_m': meters, 'pixels_per_meter': ppm},
        'views': views, 'measured_dimensions_m': measured,
        'requested_dimensions_m': target,
        'difference_from_requested_dimensions_percent': target_error,
        'three_view_difference_percent': consistency,
        'acceptance': {
            'requested_canvas_1536x512': [width, height] == [1536, 512],
            'three_views_within_8_percent': all(v <= 8 for v in consistency.values()),
            'front_and_right_ground_within_8px_soil_after_uniform_normalization': all(views[k]['body_pixels_below_soil_allowance'] == 0 for k in ('front', 'right')),
            'all_view_horizontal_centers_within_6_percent': all(abs(v['horizontal_center_error_percent_of_cell']) <= 6 for v in views.values()),
            'luminance_at_least_18': result['body_luminance_std_rec709'] >= 18,
            'original_png_ready_for_direct_geometry_import': False,
        },
    })
    note = (
        f"原寸{width}×{height}px。alpha≥128の輪郭を実測。1セル={meters}m。"
        'width=正面幅、depth=平面の上下幅、height=正面輪郭の高さ（土の接触縁を含む）。'
        f"三面差（幅/奥行/高さ）={consistency['front_vs_top_width_percent']:.2f}%/"
        f"{consistency['right_width_vs_top_depth_percent']:.2f}%/{consistency['front_vs_right_height_percent']:.2f}%。"
        '生成原本は未加工。縮尺・地面位置の正規化と三面の照合が必要。'
    )
    pattern = {'id': record['id'], 'file': filename, 'size': record['size'], **measured, 'tags': record['tags'], 'note': note}
    return result, pattern


def measure_cliff(record):
    filename = record['file']
    result, alpha, body, _ = load_png(filename)
    width, height = result['width_px'], result['height_px']
    ppm = width / 24
    ground = height * 704 / 768
    tops = np.full(width, height, dtype=int)
    occupied = body.any(axis=0)
    tops[occupied] = np.argmax(body[:, occupied], axis=0)
    heights = np.where(occupied, (ground - tops) / ppm, 0)
    edge_heights = [r4(heights[0]), r4(heights[-1])]
    border = round(width * 0.08)
    middle = heights[border:width - border]
    middle_range = [r4(middle.min()), r4(middle.max())]
    targets = record['target']['edgesM']
    errors = [r4(abs(edge_heights[i] - targets[i])) for i in (0, 1)]
    lower = int(np.floor(height * 720 / 768)) + 1
    exit_info = None
    if record['id'] in ('C-19', 'C-20'):
        side = 'right' if record['id'] == 'C-19' else 'left'
        strip = alpha[:, 3 * width // 4:] if side == 'right' else alpha[:, :width // 4]
        exit_info = {
            'side': side, 'width_px': strip.shape[1],
            'maximum_alpha': int(strip.max()),
            'nonzero_alpha_pixels': int(np.count_nonzero(strip)),
            'body_pixels_at_alpha128': int(np.count_nonzero(strip >= ALPHA_THRESHOLD)),
            'strictly_transparent': not bool(np.any(strip)),
        }
    result.update({
        'id': record['id'], 'name': record['name'], 'group': 'cliffs', 'tags': record['tags'],
        'measured_edge_heights_m': edge_heights,
        'requested_edge_heights_m': targets, 'edge_error_m': errors,
        'measured_middle_crest_height_range_m': middle_range,
        'body_bottom_y': result['body_bbox_exclusive_px'][3] - 1,
        'pixels_below_allowed_y720_at_alpha128': int(body[lower:, :].sum()),
        'pixels_below_allowed_y720_at_any_alpha': int(np.count_nonzero(alpha[lower:, :])),
        'exit_strip': exit_info,
        'acceptance': {
            'requested_canvas_2048x768': [width, height] == [2048, 768],
            'edge_heights_within_0_3m': all(v <= 0.3 for v in errors),
            'body_within_ground_soil_allowance_at_alpha128': not bool(body[lower:, :].any()),
            'strict_transparency_below_soil_allowance': not bool(alpha[lower:, :].any()),
            'luminance_at_least_18': result['body_luminance_std_rec709'] >= 18,
            'luminance_target_20_to_35': 20 <= result['body_luminance_std_rec709'] <= 35,
            'all_pair_connector_visual_compatibility_verified': False,
            'depth_map_provided': False,
        },
    })
    note = 'alpha≥128で外縁の高さと中央84%の稜線範囲を測定。深度図なし。端8%の溝は目視確認、全組合せの接続は未検証。低alphaの残留はvalidation.jsonを参照。'
    if exit_info:
        note += f"出口の{exit_info['side']}側512pxはalpha≥128の本体{exit_info['body_pixels_at_alpha128']}画素、非0alpha{exit_info['nonzero_alpha_pixels']}画素。"
    pattern = {'id': record['id'], 'file': filename, 'height': middle_range, 'edges': edge_heights, 'tags': record['tags'], 'note': note}
    return result, pattern


def measure_tile(record):
    filename = record['file']
    result, _, _, luma = load_png(filename)
    horizontal_internal = np.abs(np.diff(luma, axis=1)).mean()
    vertical_internal = np.abs(np.diff(luma, axis=0)).mean()
    result.update({
        'id': record['id'], 'name': record['name'], 'group': 'tiles', 'tags': record['tags'],
        'seam_mean_absolute_difference_ratio_to_internal': {
            'left_right': r4(np.abs(luma[:, 0] - luma[:, -1]).mean() / horizontal_internal),
            'top_bottom': r4(np.abs(luma[0, :] - luma[-1, :]).mean() / vertical_internal),
        },
        'acceptance': {
            'requested_canvas_1024x1024': [result['width_px'], result['height_px']] == [1024, 1024],
            'luminance_std_20_to_35': 20 <= result['body_luminance_std_rec709'] <= 35,
            'seamless_repeat_verified': False,
        },
    })
    note = f"原寸{result['width_px']}×{result['height_px']}px、輝度標準偏差{result['body_luminance_std_rec709']:.2f}。2×2反復で継ぎ目と模様の繰り返しが残る。1024pxへの変換・継ぎ目処理が必要。原本未加工。"
    pattern = {'id': record['id'], 'file': filename, 'tags': record['tags'], 'note': note}
    return result, pattern


def main():
    source_records = {
        'rocks': read_json('rocks_generation.json')['records'],
        'cliffs': read_json('cliffs_generation.json')['records'],
        'tiles': read_json('tiles_generation.json')['tiles'],
    }
    expected = {'rocks': 20, 'cliffs': 20, 'tiles': 4}
    for group, records in source_records.items():
        assert len(records) == expected[group], f'{group}: expected {expected[group]}, got {len(records)}'
    patterns, measurements = {k: [] for k in expected}, []
    for group, function in [('rocks', measure_rock), ('cliffs', measure_cliff), ('tiles', measure_tile)]:
        for record in source_records[group]:
            assert set(record['tags']).issubset(TAGS), f"Invalid tags: {record['id']}"
            measurement, pattern = function(record)
            measurements.append(measurement)
            patterns[group].append(pattern)
    pngs = sorted(BASE.glob('*.png'))
    assert len(pngs) == 44, f'Expected 44 original PNGs, got {len(pngs)}'
    assert {p.name for p in pngs} == {m['filename'] for m in measurements}
    hashes = [m['sha256'] for m in measurements]
    assert len(set(hashes)) == 44, 'Unexpected duplicate image bytes'
    report = {
        'source_commit': 'b832291c24cdc7ca56445d5d87b426de21ed77bf',
        'request': 'docs/chatgpt-request-10.txt',
        'png_counts': expected, 'png_count': 44,
        'png_bytes': sum(m['bytes'] for m in measurements),
        'png_decode_failures': 0, 'duplicate_sha256': 0,
        'image_pixels_modified_by_this_script': False,
        'measurement_convention': {
            'body_alpha_threshold': 128,
            'rock_scale': 'Actual image cell width / S=2m, M=4m, L=8m. Equal scale in all views. No per-view fitting.',
            'rock_dimensions': 'front bbox width, top bbox height (depth), front bbox height including small contact trim; actual body extent, not requested target dimensions.',
            'rock_consistency_percent': 'absolute difference divided by the mean of the pair, times 100',
            'cliff_scale': 'Actual image width / 24m, ground at 704/768 of actual height. Edges are first/last image columns.',
            'cliff_middle': '84% of image width between the 8% edge bands; empty exit columns have zero height.',
            'luminance': 'Rec.709 weighted RGB values on 0–255 encoded channels; population standard deviation on alpha>=128 body pixels.',
            'alpha_note': 'A thresholded silhouette can pass while low-alpha noise fails exact transparent-background rules. Both are reported.',
        },
        'npm_ci': 'success; Node.js v24.22.3; npm ci --no-audit --no-fund',
        'production_acceptance': 'pending; not all requested numeric constraints pass',
        'records': measurements,
    }
    write_json('patterns.json', patterns)
    write_json('validation.json', report)
    write_json('manifest.json', {'request': 10, 'source_commit': report['source_commit'], 'assets': [
        {k: m[k] for k in ('id', 'name', 'group', 'filename', 'width_px', 'height_px', 'mode', 'bytes', 'sha256')}
        for m in measurements
    ]})
    lines = [
        '# 実測による受入差分', '',
        '本体は alpha≥128 で計測。低alphaの残留は別途 `validation.json` に記録。元PNGは変更していません。', '',
        '## 岩：三面図と地面の差', '',
        '正面の幅、平面の奥行、正面の高さをmへ換算。三面差はペアの平均に対する絶対差です。地面差は画像全体を512px高に正規化したときの下端−384px。', '',
        '| ID | 実測 幅×奥行×高さ m | 幅の三面差 | 奥行の三面差 | 高さの三面差 | 地面差 正面/右 px | 三面±8% |',
        '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ]
    for m in measurements:
        if m['group'] != 'rocks':
            continue
        d, c, v = m['measured_dimensions_m'], m['three_view_difference_percent'], m['views']
        lines.append(f"| {m['id']} | {d['width']:.3f}×{d['depth']:.3f}×{d['height']:.3f} | {c['front_vs_top_width_percent']:.2f}% | {c['right_width_vs_top_depth_percent']:.2f}% | {c['front_vs_right_height_percent']:.2f}% | {v['front']['bottom_delta_from_ground_normalized_px']:+.1f} / {v['right']['bottom_delta_from_ground_normalized_px']:+.1f} | {'適合' if m['acceptance']['three_views_within_8_percent'] else '不適合'} |")
    lines += ['', '## 崖：高さと接地', '', '| ID | 実測中央の高さ m | 左端/右端 m | 端±0.3m | 本体下端 y | 輝度σ |', '| --- | --- | --- | --- | ---: | ---: |']
    for m in measurements:
        if m['group'] != 'cliffs':
            continue
        h, e = m['measured_middle_crest_height_range_m'], m['measured_edge_heights_m']
        lines.append(f"| {m['id']} | {h[0]:.3f}–{h[1]:.3f} | {e[0]:.3f} / {e[1]:.3f} | {'適合' if m['acceptance']['edge_heights_within_0_3m'] else '不適合'} | {m['body_bottom_y']} | {m['body_luminance_std_rec709']:.2f} |")
    lines += ['', '## 岩肌：濃淡と反復', '', '| ID | 実寸 px | 輝度σ | σ20〜35 | 継ぎ目 |', '| --- | --- | ---: | --- | --- |']
    for m in measurements:
        if m['group'] == 'tiles':
            lines.append(f"| {m['id']} | {m['width_px']}×{m['height_px']} | {m['body_luminance_std_rec709']:.2f} | {'適合' if m['acceptance']['luminance_std_20_to_35'] else '不適合'} | 要処理・未合格 |")
    (BASE / 'acceptance-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('png_counts', 'png_count', 'png_bytes', 'png_decode_failures', 'duplicate_sha256', 'production_acceptance')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
