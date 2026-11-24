#!/usr/bin/env python3
"""景色の絵（依頼 8）を、ゲームで読む形へ直す（npm run env:art）。

  art-source/env/*.png  →  public/assets/textures/env/*.webp
  測った値は art-source/env/request8_v1.measure.json に残す。

やること（絵そのものは描き足さない。色の帯・つなぎ目・透明だけを直す）:
  A 遠景   上の帯を空の色 #C5D2CB、下の帯を霧の色 #AEBCAB に合わせる。
           左右の端 8% を、同じ場所の 2 枚で共通の「霧の縦の色」へ溶かす（どの順でつないでも段が出ない）。
           空の部分を透明にする（v0.19.0。空はゲームの側で描く）: 雲と空は明るく（明るさ 0.75 以上）、山は暗いので、
           列ごとに、上から見て最初に暗い所が続く行を山の稜線とし、それより上を透明にする（稜線から下へ 8px でなめらかに）。
           稜線より上の色は、稜線のすぐ下の色で埋める（ふちに空の色が残らないように）。左右の端では、稜線の高さを 2 枚で共通の高さへ寄せる。
  B 地面   B-1・2・3・4・6 は、半分ずらした自分と混ぜて、上下左右の端がつながるようにする。
           B-5（石畳）と B-7（晶脈の岩）は形がはっきりしていて混ぜると二重に見えるので、そのまま出し、
           ゲームの側で鏡写しに繰り返す。
           岩の 2 枚（B-6・B-7）は、元の絵の濃淡がとても弱い（明るさのばらつき 5〜6）ので、割れ目と面の濃淡を強める
           （v0.19.0。細かな濃淡を ROCK_DETAIL の 1 つめの倍、大きな濃淡を 2 つめの倍。平均の色は変えない）。
           狩場の地面の 3 枚（B-1・2・3）も、細かな濃淡だけを少し強める。
  C 草     透明な所の色を、近くの絵の色で埋める（縮小した時に、ふちが黒や白にならないように）。
  D 建物   無地の背景を透明にする（武器立てなど、すき間のある物を板に貼るため）。

出力は手で編集しない。元の PNG を変えたら、もう一度これを走らせる。
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'env')
OUT = os.path.join(ROOT, 'public', 'assets', 'textures', 'env')

SKY = np.array([0xC5, 0xD2, 0xCB], dtype=np.float32)
FOG = np.array([0xAE, 0xBC, 0xAB], dtype=np.float32)

FAR = {'basin': ['env_basin_far_a_v1', 'env_basin_far_b_v1'], 'village': ['env_village_far_a_v1', 'env_village_far_b_v1']}
BLEND = ['tex_ground_basin_grass_v1', 'tex_ground_basin_gravel_v1', 'tex_ground_nest_v1', 'tex_ground_village_earth_v1', 'tex_rock_basin_v1']
MIRROR = ['tex_ground_village_paving_v1', 'tex_rock_vein_v1']
SPRITES = ['sprite_grass_basin_v1', 'sprite_props_basin_v1']
# 岩の絵の濃淡を強める倍（細かな濃淡, 大きな濃淡）。境目は、繰り返し方（つなぐ・鏡写し）に合わせて扱う
ROCK_DETAIL = {'tex_rock_basin_v1': (3.0, 1.8), 'tex_rock_vein_v1': (2.4, 1.5),
               # 地面も少しだけ（強くすると、6m ごとの繰り返しが目に付く）
               'tex_ground_basin_grass_v1': (1.7, 1.0), 'tex_ground_basin_gravel_v1': (1.5, 1.0), 'tex_ground_nest_v1': (1.5, 1.0)}
BUILDINGS = ['bld_workshop_v1', 'bld_shop_v1', 'bld_board_v1', 'bld_chest_v1']


def load(name, mode='RGB'):
    return np.asarray(Image.open(os.path.join(SRC, name + '.png')).convert(mode), dtype=np.float32)


def save(name, arr, quality):
    img = Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8))
    path = os.path.join(OUT, name + '.webp')
    img.save(path, 'WEBP', quality=quality, method=6)
    return os.path.getsize(path)


def hexof(c):
    return '#%02X%02X%02X' % tuple(int(round(float(v))) for v in c[:3])


def smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------- A 遠景 ----------

def far_bands(img):
    """上の帯と下の帯の色を、空と霧の色へ寄せる（上下で違う量を、縦になめらかに足す）。"""
    h = img.shape[0]
    top = int(round(h * 0.06))
    bot = int(round(h * 0.22))
    t_med = np.median(img[:top].reshape(-1, 3), axis=0)
    b_med = np.median(img[h - bot:].reshape(-1, 3), axis=0)
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    out = img + (SKY - t_med) * (1 - y) + (FOG - b_med) * y
    # 帯の中は、端へ向かって、指定の 1 色にする（帯の内側の境は、絵のまま）
    rows = np.arange(h, dtype=np.float32)
    w_top = smooth(1 - rows / top)[:, None, None]
    out = out * (1 - w_top) + SKY * w_top
    w_bot = smooth((rows - (h - bot)) / (bot * 0.55))[:, None, None]
    out = out * (1 - w_bot) + FOG * w_bot
    return out, hexof(t_med), hexof(b_med)


def far_edges(imgs):
    """左右の端 8% を、2 枚で共通の縦の色（端の列の平均）へ溶かす。"""
    w = imgs[0].shape[1]
    band = int(round(w * 0.08))
    cols = []
    for im in imgs:
        cols.append(im[:, :16].mean(axis=1))
        cols.append(im[:, w - 16:].mean(axis=1))
    edge = np.mean(cols, axis=0)
    edge = ndimage.gaussian_filter1d(edge, sigma=6, axis=0)[:, None, :]
    x = np.arange(w, dtype=np.float32)
    wl = smooth(1 - x / band)
    wr = smooth((x - (w - 1 - band)) / band)
    wgt = np.maximum(wl, wr)[None, :, None]
    return [im * (1 - wgt) + edge * wgt for im in imgs]


SKY_LUMA = 0.735  # これより暗い所が続けば、山（雲と空は 0.75〜0.84）
SKY_FADE = 8.0


def far_ridge(img):
    """列ごとの、山の稜線の行（上から）。元の絵（帯を直す前）の明るさで決める。"""
    h, w = img.shape[:2]
    lum = ndimage.gaussian_filter((img / 255.0) @ np.array([0.299, 0.587, 0.114], dtype=np.float32), 1.5)
    mask = ndimage.binary_opening(lum < SKY_LUMA, iterations=2)
    run = ndimage.uniform_filter1d(mask.astype(np.float32), 12, axis=0, origin=-5)
    cand = mask & (run > 0.6)
    top = np.full(w, float(h * 0.62))
    lim = int(h * 0.7)
    for x in range(w):
        idx = np.nonzero(cand[:lim, x])[0]
        if len(idx):
            top[x] = idx[0]
    top = ndimage.median_filter(top, 9)
    top = ndimage.minimum_filter1d(top, 5)
    return ndimage.gaussian_filter1d(top, 1.5)


def far_ridge_edges(tops):
    """左右の端 8% で、稜線の高さを、同じ場所の 2 枚で共通の高さ（端の高さの平均）へ寄せる。"""
    w = len(tops[0])
    band = int(round(w * 0.08))
    edge = float(np.mean([t[:8].mean() for t in tops] + [t[-8:].mean() for t in tops]))
    x = np.arange(w, dtype=np.float32)
    wgt = np.maximum(smooth(1 - x / band), smooth((x - (w - 1 - band)) / band))
    return [t * (1 - wgt) + edge * wgt for t in tops], edge


def far_cut(img, top):
    """稜線より上を透明にする（稜線から下へ SKY_FADE px でなめらかに）。上の色は、稜線のすぐ下の色で埋める。"""
    h, w = img.shape[:2]
    yy = np.arange(h, dtype=np.float32)[:, None]
    alpha = smooth((yy - top[None, :]) / SKY_FADE)
    src = np.clip(np.ceil(top + SKY_FADE + 1), 0, h - 1).astype(int)
    out = img.copy()
    above = yy < (top + SKY_FADE + 1)[None, :]
    fill = img[src, np.arange(w)]  # (w, 3)
    out = np.where(above[..., None], fill[None, :, :], out)
    return np.dstack([out, alpha * 255])


# ---------- B 地面と岩 ----------

def seam(img):
    """端をまたぐ隣どうしの差 ÷ 中の隣どうしの差（1 に近いほど、つなぎ目が見えない）。"""
    lr = np.abs(img[:, 0] - img[:, -1]).mean() / np.abs(img[:, 1:] - img[:, :-1]).mean()
    tb = np.abs(img[0] - img[-1]).mean() / np.abs(img[1:] - img[:-1]).mean()
    return round(float(lr), 2), round(float(tb), 2)


def vblend(a, b, w):
    """a と b を重み w で混ぜる。細かな模様の強さが弱まらないよう、ばらつきを保つ。"""
    mean = a.reshape(-1, 3).mean(axis=0)
    return mean + (w * (a - mean) + (1 - w) * (b - mean)) / np.sqrt(w * w + (1 - w) ** 2)


def detail(img, fine, broad, wrap):
    """濃淡を強める。ぼかした絵（大きな濃淡）と、残り（細かな濃淡）に分けて、それぞれ倍にする。平均の色は変えない。"""
    mean = img.reshape(-1, 3).mean(axis=0)
    low = ndimage.gaussian_filter(img, sigma=(14, 14, 0), mode='wrap' if wrap else 'reflect')
    out = mean + (low - mean) * broad + (img - low) * fine
    out = np.clip(out, 0, 255)
    # 切った分だけ平均がずれるので、戻す
    return np.clip(out + (mean - out.reshape(-1, 3).mean(axis=0)), 0, 255)


def make_tile(img):
    h, w = img.shape[:2]
    x = np.arange(w, dtype=np.float32)
    wx = smooth(np.minimum(x, w - 1 - x) / (w * 0.25))[None, :, None]
    out = vblend(img, np.roll(img, w // 2, axis=1), wx)
    y = np.arange(h, dtype=np.float32)
    wy = smooth(np.minimum(y, h - 1 - y) / (h * 0.25))[:, None, None]
    return vblend(out, np.roll(out, h // 2, axis=0), wy)


# ---------- C・D 透明 ----------

def bleed(rgba, cut=24):
    """透明な所の色を、いちばん近い絵の色で埋める（alpha は変えない）。"""
    solid = rgba[..., 3] >= cut
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    out = rgba.copy()
    out[..., :3] = rgba[idx[0], idx[1], :3]
    return out


def cells(rgba):
    """2 × 2 のマスごとに、絵のある範囲（px）と、根元の横位置。"""
    res = []
    for cy in range(2):
        for cx in range(2):
            a = rgba[cy * 512:(cy + 1) * 512, cx * 512:(cx + 1) * 512, 3] >= 128
            ys, xs = np.nonzero(a)
            y1 = int(ys.max())
            foot = xs[ys >= y1 - 12]
            res.append({'x0': cx * 512 + int(xs.min()), 'x1': cx * 512 + int(xs.max()) + 1, 'y0': cy * 512 + int(ys.min()), 'y1': cy * 512 + y1 + 1,
                        'rootX': cx * 512 + int(round(float(foot.mean())))})
    return res


def key_background(rgb):
    """無地の背景を透明にする。背景と同じ色でも、小さな点（絵の中の明るい所）は残す。"""
    h, w = rgb.shape[:2]
    corners = np.concatenate([rgb[:24, :24].reshape(-1, 3), rgb[:24, -24:].reshape(-1, 3), rgb[-24:, :24].reshape(-1, 3), rgb[-24:, -24:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.abs(rgb - bg).max(axis=2)
    like = dist < 13
    lab, n = ndimage.label(like)
    area = ndimage.sum(like, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = area >= 160
    back = keep[lab]
    # ふちは 2px ぶん、色の差でなめらかに
    near = ndimage.binary_dilation(back, iterations=2)
    alpha = np.where(back, 0.0, np.where(near, smooth((dist - 10) / 22.0), 1.0)).astype(np.float32)
    rgba = np.dstack([rgb, alpha * 255])
    return bleed(rgba), hexof(bg), float(back.mean())


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    total = 0

    for place, names in FAR.items():
        fixed, tops = [], []
        for n in names:
            src = load(n)
            tops.append(far_ridge(src))
            img, t, b = far_bands(src)
            report[n] = {'kind': 'far', 'place': place, 'topBefore': t, 'bottomBefore': b}
            fixed.append(img)
        fixed = far_edges(fixed)
        tops, edge = far_ridge_edges(tops)
        for n, img, top in zip(names, fixed, tops):
            h = img.shape[0]
            report[n]['topAfter'] = hexof(np.median(img[:int(h * 0.06)].reshape(-1, 3), axis=0))
            report[n]['bottomAfter'] = hexof(np.median(img[h - int(h * 0.12):].reshape(-1, 3), axis=0))
            report[n]['edgeStep'] = round(float(np.abs(img[:, 0] - fixed[0][:, -1]).mean()), 2)
            rgba = far_cut(img, top)
            report[n]['ridge'] = {'min': round(float(top.min() / h), 3), 'max': round(float(top.max() / h), 3), 'edge': round(edge / h, 3),
                                  'alphaTop': round(float(rgba[:int(h * 0.3), :, 3].mean() / 255), 3), 'alphaBottom': round(float(rgba[int(h * 0.6):, :, 3].mean() / 255), 3)}
            report[n]['bytes'] = save(n, rgba, 84)
            total += report[n]['bytes']

    for n in BLEND + MIRROR:
        img = load(n)
        before = seam(img)
        out = make_tile(img) if n in BLEND else img
        if n in ROCK_DETAIL:
            out = detail(out, *ROCK_DETAIL[n], wrap=n in BLEND)
        report[n] = {'kind': 'tile', 'wrap': 'repeat' if n in BLEND else 'mirror', 'mean': hexof(out.reshape(-1, 3).mean(axis=0)), 'seamBefore': before, 'seamAfter': seam(out),
                     'contrastBefore': round(float(img.std()), 2), 'contrastAfter': round(float(out.std()), 2)}
        report[n]['bytes'] = save(n, out, 82)
        total += report[n]['bytes']

    for n in SPRITES:
        rgba = load(n, 'RGBA')
        report[n] = {'kind': 'sprite', 'cells': cells(rgba)}
        report[n]['bytes'] = save(n, bleed(rgba), 86)
        total += report[n]['bytes']

    for n in BUILDINGS:
        rgba, bg, share = key_background(load(n))
        report[n] = {'kind': 'building', 'background': bg, 'transparentShare': round(share, 3)}
        report[n]['bytes'] = save(n, rgba, 86)
        total += report[n]['bytes']

    with open(os.path.join(SRC, 'request8_v1.measure.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write('\n')
    for n, r in report.items():
        print(n, json.dumps({k: v for k, v in r.items() if k != 'cells'}, ensure_ascii=False))
    print('total', round(total / 1024), 'KB,', len(report), 'files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
