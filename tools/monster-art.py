#!/usr/bin/env python3
"""大型 11 種（登録簿の 02〜12）の原画を、体へ横から貼る絵へ直す（npm run monsters:art）。

  art-source/monster/concepts/monster_NN_<key>_concept_v2.png
    →  public/assets/textures/monsters/<key>_side_v1.webp   （ゲームが読む絵）
    →  src/render/creatureArt.ts                            （絵の切り出し位置。生成物。手で編集しない）
    →  art-source/monster/concepts/side_v1.measure.json     （測った値の記録）

やること（絵そのものは描き足さない）:
  1. 無地の背景（四辺の色の中央値）と違う所を、体の形（シルエット）とする。小さな点は捨てる。
  2. 体の形の外側（と、ふちの 2px）の色を、いちばん近い体の色で埋める。
     立体の上面・下面・ふちは、横から写すと形の外の色を拾うので、背景の色が出ないようにする。
  3. 体の形を囲む四角（余白 16px）で切り出し、幅 1024px 以下へ縮める。

体の立体は src/render/creaturePlans.ts（tools/gen-monsters.py の出力）が、原画の px の座標で持つ。
貼る時は、立体の (z, y) を原画の (x, y) へ戻し、この切り出し位置で絵の uv にする。
出力は手で編集しない。元の PNG を変えたら、もう一度これを走らせる。
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'monster', 'concepts')
OUT = os.path.join(ROOT, 'public', 'assets', 'textures', 'monsters')
TS = os.path.join(ROOT, 'src', 'render', 'creatureArt.ts')
MEASURE = os.path.join(SRC, 'side_v1.measure.json')

# 番号と ID（登録簿の art の名前と同じ）
SPECIES = [(2, 'selvark'), (3, 'numeradon'), (4, 'bornakel'), (5, 'ashreia'), (6, 'lumisca'), (7, 'orglass'),
           (8, 'tengaro'), (9, 'verito'), (10, 'razmer'), (11, 'kirisave'), (12, 'velgait')]
MAX_W = 1024
MARGIN = 16


def silhouette(rgb):
    """背景と違う所（体）。fill は穴を埋めた形（寸法を測る用）、solid はふちを 2px 削った形（色を取る用）。"""
    border = np.concatenate([rgb[:16].reshape(-1, 3), rgb[-16:].reshape(-1, 3), rgb[:, :16].reshape(-1, 3), rgb[:, -16:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.abs(rgb - bg).max(axis=2)
    fg = ndimage.binary_opening(dist > 22, iterations=2)
    lab, n = ndimage.label(fg)
    area = ndimage.sum(fg, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = area >= area.max() * 0.02
    fg = keep[lab]
    solid = ndimage.binary_erosion(fg, iterations=2)
    return fg, ndimage.binary_fill_holes(fg), solid, bg


def bleed(rgb, solid):
    """solid の外の色を、いちばん近い solid の色で埋める。"""
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    return rgb[idx[0], idx[1]]


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    ts = []
    for no, key in SPECIES:
        src = os.path.join(SRC, f'monster_{no:02d}_{key}_concept_v2.png')
        rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
        h, w = rgb.shape[:2]
        fg, filled, solid, bg = silhouette(rgb)
        ys, xs = np.nonzero(filled)
        bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        x0, y0 = max(0, bx0 - MARGIN), max(0, by0 - MARGIN)
        x1, y1 = min(w, bx1 + MARGIN), min(h, by1 + MARGIN)
        out = bleed(rgb, solid)[y0:y1, x0:x1]
        avg = rgb[solid].mean(axis=0) / 255.0
        img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        scale = min(1.0, MAX_W / img.width)
        size = (round(img.width * scale), round(img.height * scale))
        img = img.resize(size, Image.LANCZOS)
        path = os.path.join(OUT, f'{key}_side_v1.webp')
        img.save(path, 'WEBP', quality=80, method=6)
        nbytes = os.path.getsize(path)
        report[key] = {
            'source': os.path.relpath(src, ROOT), 'image': [w, h], 'background': '#%02x%02x%02x' % tuple(int(round(c)) for c in bg),
            'bbox': [bx0, by0, bx1, by1], 'crop': [x0, y0, x1, y1], 'out': list(size), 'bytes': nbytes,
            'share': round(float(filled.mean()), 3), 'average': [round(float(c), 3) for c in avg],
        }
        ts.append(f"  {key}: {{ file: 'assets/textures/monsters/{key}_side_v1.webp', crop: [{x0}, {y0}, {x1}, {y1}], bbox: [{bx0}, {by0}, {bx1}, {by1}], average: [{avg[0]:.3f}, {avg[1]:.3f}, {avg[2]:.3f}] }},")
        print(f'{key:10s} bbox {bx0},{by0}-{bx1},{by1}  out {size[0]}x{size[1]}  {nbytes // 1024}KB')
    with open(MEASURE, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write('\n')
    with open(TS, 'w', encoding='utf-8') as f:
        f.write('// 生成物（npm run monsters:art = tools/monster-art.py）。手で編集しない。\n')
        f.write('// 原画の、体へ貼るために切り出した範囲（原画の px）。crop = 絵に入れた範囲、bbox = 体の形を囲む四角。\n')
        f.write('export interface CreatureArt {\n  file: string;\n  crop: [number, number, number, number];\n  bbox: [number, number, number, number];\n  /** 体の色の平均（0〜1。絵が読み込まれるまでの色） */\n  average: [number, number, number];\n}\n\n')
        f.write('export const CREATURE_ART: Record<string, CreatureArt> = {\n')
        f.write('\n'.join(ts) + '\n};\n')
    total = sum(r['bytes'] for r in report.values())
    print(f'合計 {total // 1024}KB')


if __name__ == '__main__':
    main()
