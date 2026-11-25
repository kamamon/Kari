#!/usr/bin/env python3
"""ハンターの体の絵（public/assets/textures/hunter/hunter_body_v1.webp）から、肌と髪の区画の印を作る（npm run hunter:masks。v0.28.0）。

  → public/assets/textures/hunter/hunter_mask_v1.png   体の絵と同じ大きさ。R = 肌、G = 髪（0〜255。0 は色を変えない）
    art-source/player/hunter_mask_v1.measure.json       測った値（区画ごとの画素の数・色の平均）

外見の変更（肌の色・髪の色。src/render/appearance.ts）で、この印のある所だけ色を替える（服・革・金具・目には混ぜない）。
決め方（絵の色を Lab で見て、区画の場所で絞る。絵は描き足さない）:
  肌  頭・腕の区画と、胴と外套の区画の上の端（首もと。胴は、えりの間の胸もとまでの、いちばん大きな塊）だけ。a（赤み）が 9〜13 で立ち上がり、明るさ L > 30・b > 13。
      服（麻のシャツ）は a が 5〜10 なので入らない。目・眉・唇の暗い所は L で落ちる（唇は肌に入る）。
  髪  頭の区画だけ。L < 56 で a < 12 の、いちばん大きなつながった塊（後ろ頭から前髪まで 1 つ）。
      目・鼻の穴・眉の小さな暗い所は、別の塊なので入らない（眉の色は、まだ髪に付いていかない）。
  輪郭は 1px ぼかす。出力は手で編集しない。元の絵を変えたら、もう一度これを走らせる。
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import color

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'assets', 'textures', 'hunter', 'hunter_body_v1.webp')
OUT = os.path.join(ROOT, 'public', 'assets', 'textures', 'hunter', 'hunter_mask_v1.png')
MEASURE = os.path.join(ROOT, 'art-source', 'player', 'hunter_mask_v1.measure.json')
# src/render/hunterAtlas.ts の区画（2048 四方の px）
ATLAS = 2048
RECTS = {
    'legL': [80, 8, 611, 810], 'legR': [627, 8, 1158, 810], 'torso': [1174, 8, 2014, 754], 'armL': [8, 826, 357, 1456],
    'armR': [373, 826, 722, 1456], 'head': [738, 826, 2040, 1441], 'skirt': [8, 1472, 1088, 1754], 'footL': [1104, 1472, 1415, 1729],
    'footR': [1431, 1472, 1742, 1729], 'mantle': [8, 1770, 1259, 2011],
}
# 肌を探す区画と、その中の縦の範囲（区画の高さの割合。胴と外套は首もとの上の端だけ）と、明るさの下限
# 胴は、えりの間の胸もと（V の下の端まで）を入れ、いちばん大きなつながった塊（首から胸もと）だけを残す（金具の光った所を落とす）
SKIN_CHARTS = {'head': (0, 1, 28), 'armL': (0, 1, 28), 'armR': (0, 1, 28), 'torso': (0, 0.2, 28), 'mantle': (0, 0.22, 28)}
ONE_BLOB = {'torso'}


def ramp(x, a, b):
    return np.clip((x - a) / (b - a), 0, 1)


def main():
    rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64) / 255
    H, W = rgb.shape[:2]
    s = W / ATLAS
    lab = color.rgb2lab(rgb)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    skin = np.zeros((H, W))
    hair = np.zeros((H, W))
    measure = {'px': [W, H], 'charts': {}}

    def box(name):
        x0, y0, x1, y1 = RECTS[name]
        return int(round(x0 * s)), int(round(y0 * s)), int(round(x1 * s)), int(round(y1 * s))

    for name, (f0, f1, lmin) in SKIN_CHARTS.items():
        x0, y0, x1, y1 = box(name)
        ya, yb = y0 + int((y1 - y0) * f0), y0 + int((y1 - y0) * f1)
        sl = (slice(ya, yb), slice(x0, x1))
        w = ramp(A[sl], 9, 13) * ramp(L[sl], lmin, lmin + 8) * ramp(B[sl], 11, 15)
        if name in ONE_BLOB:
            lab_s, n_s = ndimage.label(w > 0.3)
            if n_s:
                sizes = ndimage.sum(w > 0.3, lab_s, index=np.arange(1, n_s + 1))
                keep = ndimage.binary_dilation(lab_s == int(np.argmax(sizes)) + 1, iterations=2)
                w = np.where(keep, w, 0)
        skin[sl] = np.maximum(skin[sl], w)
    # 髪: 頭の区画の、暗くて赤みの少ない画素の、いちばん大きな塊
    x0, y0, x1, y1 = box('head')
    sl = (slice(y0, y1), slice(x0, x1))
    dark = (L[sl] < 56) & (A[sl] < 12)
    dark = ndimage.binary_opening(dark, iterations=1)
    lab_c, n = ndimage.label(dark)
    if n:
        sizes = ndimage.sum(dark, lab_c, index=np.arange(1, n + 1))
        big = int(np.argmax(sizes)) + 1
        main = lab_c == big
        # 塊の中の小さな穴（毛先の明るい所）も髪に
        main = ndimage.binary_fill_holes(main) & ~((skin[sl] > 0.5) & ~main)
        soft = ramp(56 - L[sl], 0, 6) * ramp(12 - A[sl], 0, 3)
        hair[sl] = np.where(main, np.maximum(soft, 0.85), 0)
        measure['hairComponents'] = int(n)
        measure['hairMainPx'] = int(main.sum())
    # 髪の所は肌にしない
    skin = np.where(hair > 0.5, 0, skin)
    skin = ndimage.gaussian_filter(skin, 0.7)
    hair = ndimage.gaussian_filter(hair, 0.7)
    out = np.zeros((H, W, 3), np.uint8)
    out[..., 0] = np.round(np.clip(skin, 0, 1) * 255)
    out[..., 1] = np.round(np.clip(hair, 0, 1) * 255)
    Image.fromarray(out).save(OUT, optimize=True)
    for name in RECTS:
        x0, y0, x1, y1 = box(name)
        sk = skin[y0:y1, x0:x1] > 0.5
        hr = hair[y0:y1, x0:x1] > 0.5
        c = {'skinPx': int(sk.sum()), 'hairPx': int(hr.sum())}
        if sk.any():
            c['skinMeanRgb'] = [round(float(v), 4) for v in rgb[y0:y1, x0:x1][sk].mean(axis=0)]
        if hr.any():
            c['hairMeanRgb'] = [round(float(v), 4) for v in rgb[y0:y1, x0:x1][hr].mean(axis=0)]
        measure['charts'][name] = c
    # 肌と髪の基準の色（色を替える計算の「元の色」。sRGB の平均）
    allsk = skin > 0.5
    allhr = hair > 0.5
    measure['skinMeanRgb'] = [round(float(v), 4) for v in rgb[allsk].mean(axis=0)]
    measure['hairMeanRgb'] = [round(float(v), 4) for v in rgb[allhr].mean(axis=0)]
    measure['bytes'] = os.path.getsize(OUT)
    os.makedirs(os.path.dirname(MEASURE), exist_ok=True)
    with open(MEASURE, 'w', encoding='utf-8') as f:
        json.dump(measure, f, ensure_ascii=False, indent=1)
    print(f"肌 {int(allsk.sum())} px・髪 {int(allhr.sum())} px（{W}×{H}）。肌の平均 {measure['skinMeanRgb']}・髪の平均 {measure['hairMeanRgb']}。{measure['bytes'] / 1e3:.0f}KB")


if __name__ == '__main__':
    main()
