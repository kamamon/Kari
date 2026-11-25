#!/usr/bin/env python3
"""里に立てる小物の絵（v0.35.0）を、1 枚の図集にまとめる。

  入力: art-source/story/prop_story_*_v1.png（ChatGPT の物語の原画 #13 の小物。RGBA の切り抜き）
  出力: public/assets/textures/props/props_story_v1.webp（1536 × 1024。3 × 2 のます、1 つ 512 四方）
        src/render/propArt.ts（ますの場所と、絵の縦横の比。手で編集しない。npm run props:art）

絵は、透明でない所の外枠で切り、ますの中に、比を変えずに収める（下の真ん中を、ますの下の真ん中にそろえる）。
透明な所の色は、近い絵の色で埋める（縁が暗く見えないように）。
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC = os.path.join(ROOT, 'art-source', 'story')
OUT_IMG = os.path.join(ROOT, 'public', 'assets', 'textures', 'props', 'props_story_v1.webp')
OUT_TS = os.path.join(ROOT, 'src', 'render', 'propArt.ts')
CELL = 512
PAD = 6
# 名前（src/data/schemas.ts の HUB_PROP_ARTS と同じ）→ 原画
PROPS = [
    ('route_lamp_on', 'prop_story_route_lamp_on_v1.png'),
    ('route_lamp_off', 'prop_story_route_lamp_off_v1.png'),
    ('closed_route_sign', 'prop_story_closed_route_sign_v1.png'),
    ('supply_cart', 'prop_story_supply_cart_v1.png'),
    ('replaceable_parts', 'prop_story_replaceable_parts_v1.png'),
    ('record_board', 'prop_story_record_board_v1.png'),
]


def bleed(rgb, alpha, steps=24):
    """透明な所へ、となりの絵の色を少しずつ広げる"""
    rgb = rgb.astype(np.float32)
    known = alpha > 8
    for _ in range(steps):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sk = np.roll(known, (dy, dx), (0, 1))
            sr = np.roll(rgb, (dy, dx), (0, 1))
            acc += sr * sk[..., None]
            cnt += sk
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][..., None]
        known = known | grow
    return np.clip(rgb, 0, 255).astype(np.uint8)


def main():
    cols = 3
    atlas = np.zeros((CELL * 2, CELL * cols, 4), np.uint8)
    rows = []
    for i, (name, file) in enumerate(PROPS):
        im = Image.open(os.path.join(SRC, file)).convert('RGBA')
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 8)
        box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        im = im.crop(box)
        w, h = im.size
        k = min((CELL - 2 * PAD) / w, (CELL - 2 * PAD) / h)
        tw, th = max(1, round(w * k)), max(1, round(h * k))
        im = im.resize((tw, th), Image.LANCZOS)
        cx, cy = (i % cols) * CELL, (i // cols) * CELL
        x0 = cx + (CELL - tw) // 2
        y0 = cy + CELL - PAD - th
        arr = np.asarray(im).copy()
        atlas[y0:y0 + th, x0:x0 + tw] = arr
        # 根元の横の位置（細い絵は、下の 4% の行の、絵のある所の真ん中。0 = 左端、1 = 右端）。灯の柱は、絵の左寄り
        foot = arr[int(th * 0.96):, :, 3] > 128
        fx = np.nonzero(foot)[1]
        # 横に広い絵（荷車・看板）は、真ん中を軸にする（脚や轅の先を軸にすると、回る時に大きく振れる）
        root = float(fx.mean() / tw) if fx.size and w / h < 0.6 else 0.5
        rows.append((name, file, x0, y0, x0 + tw, y0 + th, w / h, root))
    rgb = bleed(atlas[..., :3], atlas[..., 3])
    out = np.dstack([rgb, atlas[..., 3]])
    os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
    Image.fromarray(out, 'RGBA').save(OUT_IMG, 'WEBP', quality=88, method=6)
    W, H = CELL * cols, CELL * 2
    ts = [
        '// tools/prop-art.py の出力（手で編集しない。npm run props:art）。里に立てる小物の絵（ChatGPT の物語の原画 #13。v0.35.0）。',
        '// 図集 public/assets/textures/props/props_story_v1.webp の中の、絵のある四角 [x0, y0, x1, y1]（px。左上が原点）と、絵の横 ÷ 縦。',
        '',
        f"export const PROP_ATLAS = {{ file: 'props_story_v1', w: {W}, h: {H} }} as const;",
        '',
        'export interface PropArt {',
        '  readonly rect: readonly [number, number, number, number];',
        '  readonly aspect: number;',
        '  /** 根元の横の位置（0 = 左端、1 = 右端）。板は、ここを軸に回る */',
        '  readonly rootX: number;',
        '  /** 原画のファイル（art-source/story/） */',
        '  readonly source: string;',
        '}',
        '',
        'export const PROP_ART: Record<string, PropArt> = {',
    ]
    for name, file, x0, y0, x1, y1, asp, root in rows:
        ts.append(f"  {name}: {{ rect: [{x0}, {y0}, {x1}, {y1}], aspect: {asp:.4f}, rootX: {root:.3f}, source: '{file}' }},")
    ts.append('};')
    with open(OUT_TS, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(ts) + '\n')
    print(f'小物 {len(rows)} 枚 → {os.path.relpath(OUT_IMG, ROOT)}（{os.path.getsize(OUT_IMG) / 1e3:.0f}KB）')


if __name__ == '__main__':
    main()
