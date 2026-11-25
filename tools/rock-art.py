#!/usr/bin/env python3
"""依頼 10（岩 20・崖 20・岩肌 4。ChatGPT）の設定図を、ゲームで読む形へ直す（npm run rocks:art。v0.22.0）。

  art-source/env/rocks/rock_rNN_v1.png    正面・右側面・平面の 3 つの図（1 枚に横へ 3 マス）
  art-source/env/cliffs/cliff_cNN_v1.png  内側から見た崖の正面（横 24m）
  art-source/env/tiles/tex_rock_tNN_v2.png 岩肌（1 枚 = 3m）
    → public/assets/textures/env/rocks_atlas_v1.webp   岩 20 種 × 3 つの図を 1 枚に詰めたもの
      public/assets/textures/env/cliffs_atlas_v1.webp  崖 20 種を 1 枚に（2 列 × 10 段、1 つ 1024 × 384）
      public/assets/textures/env/tex_rock_tNN_v2.webp   岩肌（512 四方、端がつながる）
      src/render/rockArtData.ts                       形の値（岩: 大きさ・上の線・平面の輪郭・図の範囲。崖: 上の線・凹凸・図の範囲）
      art-source/env/request10_v1.measure.json         受け入れの確認で測った値（docs/chatgpt-request-10.txt の 5 章）

直すこと（絵そのものは描き足さない）:
  共通  透明の所に残った、ごく薄い不透明（alpha 1〜23）を 0 にする。小さな粒（いちばん大きな塊の 0.4% より小さい）を除く。
  岩    図の大きさが依頼と違う（2172 × 724）ので、1 マス = 724px を、S 2m / M 4m / L 8m として測る。
        地面の線は、図ごとに測る（正面・右側面の、いちばん下の幅の広い行。依頼の 384px の線とは、ずれている）。
        3 つの図の寸法のずれ（最大 22%）は、幅 = 正面と平面の平均、奥行 = 右側面と平面の平均、高さ = 正面と右側面の平均にそろえて、
        それぞれの図を伸び縮みさせる（形は、ゲームの側で、正面と右側面の上の線と、平面の輪郭から作る）。
  崖    地面の線を測る（依頼の 704px ではなく、列ごとの下の端のいちばん多い所）。1024 × 384 に縮める。
        凹凸の図（奥行きの図）は届いていないので、明るさから作る（明るい = 手前、暗い = 奥。ぼかして大きな形だけ）。
  岩肌  大きな濃淡を除き（明るさを平らに）、半分ずらした自分と、端に近いほど混ぜて、上下左右の端をつなぐ。512 四方に縮める。

出力は手で編集しない。元の PNG を変えたら、もう一度これを走らせる。
"""
import base64
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'env')
OUT_TEX = os.path.join(ROOT, 'public', 'assets', 'textures', 'env')
OUT_TS = os.path.join(ROOT, 'src', 'render', 'rockArtData.ts')
MEASURE = os.path.join(SRC, 'request10_v1.measure.json')
PATTERNS = os.path.join(ROOT, 'docs', 'source', 'chatgpt-010', 'patterns.json')

CELL_M = {'S': 2.0, 'M': 4.0, 'L': 8.0}
# 図集に詰める時の細かさ（1m あたりの px）。入りきらなければ、全部を同じ割合で下げる
DENSITY = {'S': 210.0, 'M': 112.0, 'L': 62.0}
ATLAS = 2048
PAD = 6
# 崖: 横 24m、1 つ 1024 × 384（2 列 × 10 段）
CLIFF_W, CLIFF_H = 1024, 384
CLIFF_M = 24.0
CLIFF_TOP_N = 256
RELIEF_W, RELIEF_H = 96, 36
TILE = 512
ALPHA_CUT = 24


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def load_rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)


def clean(rgba, min_frac=0.004):
    """薄い残りを 0 に、小さな粒を除く。戻り値: (きれいにした RGBA, 不透明の印, 直した薄い残りの数)"""
    a = rgba[..., 3]
    faint = int(((a > 0) & (a < ALPHA_CUT)).sum())
    out = rgba.copy()
    out[..., 3][a < ALPHA_CUT] = 0
    solid = out[..., 3] >= 128
    lab, n = ndimage.label(solid)
    if n > 1:
        area = ndimage.sum(solid, lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = area >= area.max() * min_frac
        small = ~keep[lab] & solid
        out[..., 3][small] = 0
        solid = keep[lab]
    # 粒のまわりの半透明（縁の 1〜2px）も、粒を除いた所は消す
    near = ndimage.binary_dilation(solid, iterations=3)
    out[..., 3][~near] = 0
    return out, solid, faint


def bleed(rgba):
    """透明の所の色を、いちばん近い不透明の色で埋める（縮めた時に、ふちへ背景の色がにじまないように）"""
    solid = rgba[..., 3] >= 128
    if not solid.any():
        return rgba
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    out = rgba.copy()
    out[..., :3] = rgba[idx[0], idx[1], :3]
    return out


def ground_row(solid):
    """正面・右側面の地面の線: 幅の広い行（いちばん広い行の 60% 以上）のうち、いちばん下"""
    cover = solid.sum(axis=1)
    if cover.max() == 0:
        return solid.shape[0] - 1
    rows = np.nonzero(cover >= cover.max() * 0.6)[0]
    return int(rows.max())


def top_profile(solid, x0, x1, top, ground, n):
    """列ごとの上の端の高さ（地面から、全体の高さで割った 0〜1）を、左から n 点"""
    hgt = ground - top + 1
    cols = []
    for x in range(x0, x1):
        ys = np.nonzero(solid[top:ground + 1, x])[0]
        cols.append(0.0 if len(ys) == 0 else (ground - (top + ys.min()) + 1) / hgt)
    cols = np.array(cols)
    out = []
    for k in range(n):
        a = int(math.floor(k * len(cols) / n))
        b = max(a + 1, int(math.floor((k + 1) * len(cols) / n)))
        out.append(float(cols[a:b].max()))
    return out


def resample_loop(pts, n):
    """閉じた折れ線を、長さで等間隔に n 点"""
    p = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(np.vstack([p, p[:1]]), axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]
    out = []
    for k in range(n):
        s = k * L / n
        i = int(np.searchsorted(cum, s, side='right') - 1)
        i = min(i, len(p) - 1)
        t = (s - cum[i]) / max(1e-9, seg[i])
        a, b = p[i], p[(i + 1) % len(p)]
        out.append(a + (b - a) * t)
    return np.array(out)


def rock(no, pat):
    rid = f'R-{no:02d}'
    path = os.path.join(SRC, 'rocks', f'rock_r{no:02d}_v1.png')
    img = load_rgba(path)
    H0, W0 = img.shape[:2]
    cw = W0 // 3
    cell_m = CELL_M[pat['size']]
    mpp = cell_m / cw
    views = []
    rep = {'id': rid, 'file': os.path.relpath(path, ROOT), 'px': [W0, H0], 'cellPx': cw, 'cellM': cell_m, 'size': pat['size']}
    for k in range(3):
        sub, solid, faint = clean(img[:, k * cw:(k + 1) * cw])
        ys, xs = np.nonzero(solid)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        v = {'rgba': sub, 'solid': solid, 'faint': faint, 'bbox': [x0, y0, x1, y1]}
        if k < 2:
            g = ground_row(solid)
            v['ground'] = g
            v['top'] = y0
            v['below'] = int(y1 - 1 - g)
            v['wM'] = (x1 - x0) * mpp
            v['hM'] = (g - y0 + 1) * mpp
        else:
            v['wM'] = (x1 - x0) * mpp
            v['dM'] = (y1 - y0) * mpp
        views.append(v)
    F, S, T = views
    W = (F['wM'] + T['wM']) / 2
    D = (S['wM'] + T['dM']) / 2
    Hh = (F['hM'] + S['hM']) / 2
    err = lambda a, b: abs(a - b) / ((a + b) / 2) * 100
    sol = [v['solid'] for v in views]
    lums = np.concatenate([lum(v['rgba'][..., :3])[v['solid']] for v in views])
    centre = []
    for k, v in enumerate(views):
        x0, y0, x1, y1 = v['bbox']
        centre.append(round(((x0 + x1) / 2 - cw / 2) / cw * 100, 1))
    rep.update({
        'faintAlpha': int(sum(v['faint'] for v in views)),
        'groundPx': [F['ground'], S['ground']], 'groundAsked': round(384 * H0 / 512, 1),
        'belowGroundPx': [F['below'], S['below']],
        'frontWHm': [round(F['wM'], 3), round(F['hM'], 3)], 'sideDHm': [round(S['wM'], 3), round(S['hM'], 3)], 'topWDm': [round(T['wM'], 3), round(T['dM'], 3)],
        'diffPct': {'width': round(err(F['wM'], T['wM']), 1), 'depth': round(err(S['wM'], T['dM']), 1), 'height': round(err(F['hM'], S['hM']), 1)},
        'normalized': [round(W, 3), round(D, 3), round(Hh, 3)],
        'asked': [pat.get('width'), pat.get('depth'), pat.get('height')],
        'lumSd': round(float(lums.std()), 2),
        'centreOffsetPct': centre,
    })
    rep['pass3view'] = all(x <= 8 for x in rep['diffPct'].values())
    # 上の線: 正面は左 → 右（+x へ）、右側面は左（前）→ 右（後ろ）
    fp = top_profile(F['solid'], F['bbox'][0], F['bbox'][2], F['top'], F['ground'], 64)
    sp = top_profile(S['solid'], S['bbox'][0], S['bbox'][2], S['top'], S['ground'], 64)
    # 平面の輪郭（塊ごと）。縮めてぼかしてから等高線を取る
    tx0, ty0, tx1, ty1 = T['bbox']
    tm = T['solid'][ty0:ty1, tx0:tx1].astype(np.float32)
    sc = min(1.0, 180.0 / max(tm.shape))
    small = np.asarray(Image.fromarray((tm * 255).astype(np.uint8)).resize((max(8, round(tm.shape[1] * sc)), max(8, round(tm.shape[0] * sc))), Image.BILINEAR)).astype(np.float32) / 255
    small = ndimage.gaussian_filter(small, 1.0)
    padded = np.pad(small, 2)
    sh, sw = small.shape
    lab, n = ndimage.label(padded > 0.5)
    areas = ndimage.sum(padded > 0.5, lab, range(1, n + 1)) if n else []
    foot = []
    for ci in range(1, n + 1):
        if areas[ci - 1] < max(areas) * 0.03:
            continue
        comp = ndimage.binary_fill_holes(lab == ci)
        cs = measure.find_contours(comp.astype(np.float32), 0.5)
        if not cs:
            continue
        c = max(cs, key=len)
        # 行・列 → 平面の m（列 → x、行の下 → 前 = +z）
        pts = [((col - 2) / sw - 0.5) * W for row, col in c], [((row - 2) / sh - 0.5) * D for row, col in c]
        loop = np.stack(pts, axis=1)
        npts = int(np.clip(len(c) / 3, 24, 72))
        loop = resample_loop(loop, npts)
        # ぼかした輪郭は、外接の四角から少しはみ出すことがあるので、四角の中へ収める
        loop[:, 0] = np.clip(loop[:, 0], -W / 2, W / 2)
        loop[:, 1] = np.clip(loop[:, 1], -D / 2, D / 2)
        # 向きをそろえる（x → z へ回る向き = 面積が正）
        area = 0.5 * np.sum(loop[:, 0] * np.roll(loop[:, 1], -1) - np.roll(loop[:, 0], -1) * loop[:, 1])
        if area < 0:
            loop = loop[::-1]
        dist = ndimage.distance_transform_edt(comp)
        ry, rx = np.unravel_index(np.argmax(dist), dist.shape)
        cx, cz = ((rx - 2) / sw - 0.5) * W, ((ry - 2) / sh - 0.5) * D
        foot.append({'c': [round(float(cx), 3), round(float(cz), 3)], 'pts': [round(float(v), 3) for v in loop.reshape(-1)]})
    rep['footParts'] = len(foot)
    mean = lums.mean()
    rgbm = np.concatenate([v['rgba'][..., :3][v['solid']] for v in views]).mean(axis=0)
    return {
        'id': rid, 'no': no, 'size': pat['size'], 'tags': pat.get('tags', []),
        'w': round(W, 3), 'd': round(D, 3), 'h': round(Hh, 3), 'fp': [round(x, 3) for x in fp], 'sp': [round(x, 3) for x in sp], 'foot': foot,
        'views': views, 'mean': [round(float(c) / 255, 3) for c in rgbm], 'lum': float(mean),
    }, rep


def view_crop(v, k):
    """図集へ詰める範囲: 正面・右側面は、上の端から地面の線まで。平面は輪郭の外接の四角"""
    x0, y0, x1, y1 = v['bbox']
    if k < 2:
        y1 = v['ground'] + 1
    return bleed(v['rgba'])[y0:y1, x0:x1]


def pack(rocks):
    """岩の図を、1 枚の図集へ棚詰めする（高い順）。入りきらなければ細かさを下げる"""
    scale = 1.0
    for _ in range(30):
        items = []
        for r in rocks:
            dens = DENSITY[r['size']] * scale
            dims = [(r['w'], r['h']), (r['d'], r['h']), (r['w'], r['d'])]
            for k, (a, b) in enumerate(dims):
                items.append((r['no'], k, max(8, round(a * dens)), max(8, round(b * dens))))
        items.sort(key=lambda t: -t[3])
        x = y = shelf = 0
        place = {}
        ok = True
        for no, k, w, h in items:
            if x + w + 2 * PAD > ATLAS:
                y += shelf
                x = shelf = 0
            if y + h + 2 * PAD > ATLAS:
                ok = False
                break
            place[(no, k)] = (x + PAD, y + PAD, w, h)
            x += w + 2 * PAD
            shelf = max(shelf, h + 2 * PAD)
        if ok:
            return place, scale
        scale *= 0.94
    raise SystemExit('図集に入りきらない')


def rocks_atlas(rocks):
    place, scale = pack(rocks)
    atlas = np.zeros((ATLAS, ATLAS, 4), np.float32)
    rects = {}
    for r in rocks:
        for k, v in enumerate(r['views']):
            x, y, w, h = place[(r['no'], k)]
            crop = view_crop(v, k)
            # 縁（PAD）は、図の端の色を外へ延ばしたもの（縮めた時に、隣の図の色が混ざらないように）
            big = np.asarray(Image.fromarray(np.clip(crop + 0.5, 0, 255).astype(np.uint8), 'RGBA').resize((w, h), Image.LANCZOS)).astype(np.float32)
            padded = np.pad(big, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
            padded[..., 3] = np.pad(big[..., 3], PAD)
            atlas[y - PAD:y + h + PAD, x - PAD:x + w + PAD] = padded
            # three.js の絵は下から上へ（flipY）。v0 = 図の下（地面の側。平面図は前の側）
            rects[(r['no'], k)] = [round(x / ATLAS, 5), round(1 - (y + h) / ATLAS, 5), round((x + w) / ATLAS, 5), round(1 - y / ATLAS, 5)]
    # 透明の所の色も埋める（絵の外は、近くの色）
    solid = atlas[..., 3] >= 8
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    atlas[..., :3] = atlas[idx[0], idx[1], :3]
    return atlas, rects, scale


def cliff(no, pat):
    cid = f'C-{no:02d}'
    path = os.path.join(SRC, 'cliffs', f'cliff_c{no:02d}_v1.png')
    img = load_rgba(path)
    H0, W0 = img.shape[:2]
    sub, solid, faint = clean(img, min_frac=0.01)
    ppm = W0 / CLIFF_M
    # 地面の線: 列ごとの下の端のうち、いちばん多い行
    bottoms = []
    for x in range(0, W0, 4):
        ys = np.nonzero(solid[:, x])[0]
        if len(ys):
            bottoms.append(int(ys.max()))
    vals, cnt = np.unique(np.array(bottoms), return_counts=True)
    ground = int(vals[np.argmax(cnt)])
    tops = np.full(W0, np.nan)
    for x in range(W0):
        ys = np.nonzero(solid[:ground + 1, x])[0]
        tops[x] = (ground - ys.min() + 1) / ppm if len(ys) else 0.0
    edge = max(4, int(W0 * 0.02))
    edges = [float(np.median(tops[:edge])), float(np.median(tops[-edge:]))]
    n = CLIFF_TOP_N
    top = [round(float(tops[int(k * W0 / n):int((k + 1) * W0 / n)].max()), 3) for k in range(n)]
    lums = lum(sub[..., :3])[solid]
    exit_side = 'right' if 'exit_left' in pat.get('tags', []) else 'left' if 'exit_right' in pat.get('tags', []) else None
    empty = None
    if exit_side:
        z = tops < 0.05
        if exit_side == 'right':
            k = W0 - 1
            while k > 0 and z[k]:
                k -= 1
            empty = [round((k + 1) / ppm, 2), CLIFF_M]
        else:
            k = 0
            while k < W0 - 1 and z[k]:
                k += 1
            empty = [0.0, round(k / ppm, 2)]
    # 凹凸: 明るさを大きくぼかし、さらに大きなぼかしを引く（明るい = 手前）。不透明の所だけ
    L = lum(bleed(sub)[..., :3])
    det = ndimage.gaussian_filter(L, 10) - ndimage.gaussian_filter(L, 60)
    sd = det[solid].std() if solid.any() else 1
    rel = np.clip(det / (2.2 * sd), -1, 1)
    rel[~ndimage.binary_dilation(solid, iterations=8)] = 0
    rel_s = np.asarray(Image.fromarray(rel.astype(np.float32), 'F').resize((RELIEF_W, RELIEF_H), Image.BILINEAR))
    rel_q = np.clip(np.round(rel_s * 127), -127, 127).astype(np.int8)
    rep = {
        'id': cid, 'file': os.path.relpath(path, ROOT), 'px': [W0, H0], 'faintAlpha': faint, 'groundPx': ground, 'groundAsked': 704,
        'belowGroundPx': int(max(bottoms) - ground), 'edgesM': [round(e, 3) for e in edges], 'edgesAsked': pat.get('edges'),
        'topMaxM': round(float(np.nanmax(tops)), 3), 'lumSd': round(float(lums.std()), 2), 'empty': empty,
    }
    asked = 3.0 if max(edges) < 3.6 else 4.5
    rep['edgesPass'] = all(abs(e - asked) <= 0.3 for e in edges if e > 0.05)
    return {
        'id': cid, 'no': no, 'tags': pat.get('tags', []), 'edges': [round(e, 3) for e in edges], 'top': top, 'exit': exit_side, 'empty': empty,
        'rgba': sub, 'ground': ground, 'relief': base64.b64encode(rel_q.tobytes()).decode('ascii'),
        'mean': [round(float(c) / 255, 3) for c in sub[..., :3][solid].mean(axis=0)],
    }, rep


def cliffs_atlas(cliffs):
    rows = math.ceil(len(cliffs) / 2)
    atlas = np.zeros((rows * CLIFF_H, 2 * CLIFF_W, 4), np.float32)
    rects = {}
    for i, c in enumerate(cliffs):
        x, y = (i % 2) * CLIFF_W, (i // 2) * CLIFF_H
        im = np.asarray(Image.fromarray(np.clip(bleed(c['rgba']) + 0.5, 0, 255).astype(np.uint8), 'RGBA').resize((CLIFF_W, CLIFF_H), Image.LANCZOS)).astype(np.float32)
        atlas[y:y + CLIFF_H, x:x + CLIFF_W] = im
        H = atlas.shape[0]
        rects[c['no']] = [round(x / atlas.shape[1], 5), round(1 - (y + CLIFF_H) / H, 5), round((x + CLIFF_W) / atlas.shape[1], 5), round(1 - y / H, 5)]
        # 図の下の端から地面の線までの、図の高さに対する割合
        c['g'] = round((c['rgba'].shape[0] - 1 - c['ground']) / c['rgba'].shape[0], 4)
        c['hM'] = round(c['rgba'].shape[0] / (c['rgba'].shape[1] / CLIFF_M), 3)
    return atlas, rects


def tile(no):
    path = os.path.join(SRC, 'tiles', f'tex_rock_t{no:02d}_v2.png')
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H0, W0 = rgb.shape[:2]
    sd0 = float(lum(rgb).std())
    edge0 = float(np.abs(rgb[0] - rgb[-1]).mean() + np.abs(rgb[:, 0] - rgb[:, -1]).mean()) / 2
    img = np.asarray(Image.fromarray(rgb.astype(np.uint8)).resize((TILE, TILE), Image.LANCZOS)).astype(np.float32)
    mean = img.reshape(-1, 3).mean(axis=0)
    # 大きな濃淡を除く（明るさを平らに）
    low = ndimage.gaussian_filter(img, sigma=(TILE / 10, TILE / 10, 0), mode='wrap')
    flat = img / np.maximum(low, 1) * mean
    # 端をつなぐ
    sh = np.roll(np.roll(flat, TILE // 2, axis=0), TILE // 2, axis=1)
    y, x = np.mgrid[0:TILE, 0:TILE]
    e = np.minimum(np.minimum(x, TILE - 1 - x), np.minimum(y, TILE - 1 - y)) / (TILE / 2)
    w = np.clip(e * 2.2, 0, 1)[..., None]
    w = w * w * (3 - 2 * w)
    out = flat * w + sh * (1 - w)
    # 混ぜた所は濃淡が少し弱まるので、全体の濃淡を元の強さへ戻す
    L = lum(out)
    k = float(lum(img).std()) / max(1e-6, float(L.std()))
    out = mean + (out - out.reshape(-1, 3).mean(axis=0)) * k
    edge1 = float(np.abs(out[0] - out[-1]).mean() + np.abs(out[:, 0] - out[:, -1]).mean()) / 2
    # つなぎ目の目立ち方: 端をまたぐ差 ÷ 中の隣どうしの差（1 なら、つなぎ目は中と同じ。依頼 8 の地面と同じ測り方）
    # 中の隣どうしの差は、行（列）ごとの差の 90% の所（つなぎ目が、中のよくある段より目立たないか）
    def seam(a):
        dr = np.abs(np.diff(a, axis=0)).mean(axis=(1, 2))
        dc = np.abs(np.diff(a, axis=1)).mean(axis=(0, 2))
        return [round(float(np.abs(a[0] - a[-1]).mean()) / float(np.percentile(dr, 90)), 3), round(float(np.abs(a[:, 0] - a[:, -1]).mean()) / float(np.percentile(dc, 90)), 3)]
    rep = {'id': f'T-{no:02d}', 'file': os.path.relpath(path, ROOT), 'px': [W0, H0], 'lumSd': round(sd0, 2), 'lumSdOut': round(float(lum(out).std()), 2),
           'edgeDiff': round(edge0, 2), 'edgeDiffOut': round(edge1, 2), 'seamBefore': seam(img), 'seamAfter': seam(out)}
    return out, [round(float(c) / 255, 3) for c in out.reshape(-1, 3).mean(axis=0)], rep


def save_webp(arr, name, quality, alpha=False):
    mode = 'RGBA' if alpha else 'RGB'
    a = np.clip(arr[..., :4 if alpha else 3] + 0.5, 0, 255).astype(np.uint8)
    p = os.path.join(OUT_TEX, name + '.webp')
    Image.fromarray(a, mode).save(p, 'WEBP', quality=quality, method=6)
    return os.path.getsize(p)


def ts_num(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def main():
    pat = json.load(open(PATTERNS, encoding='utf-8'))
    pr = {int(r['id'][2:]): r for r in pat['rocks']}
    pc = {int(c['id'][2:]): c for c in pat['cliffs']}
    os.makedirs(OUT_TEX, exist_ok=True)
    report = {'rocks': [], 'cliffs': [], 'tiles': [], 'outputs': {}}
    rocks = []
    for no in range(1, 21):
        r, rep = rock(no, pr[no])
        rocks.append(r)
        report['rocks'].append(rep)
    atlas, rects, scale = rocks_atlas(rocks)
    report['outputs']['rocks_atlas_v1'] = {'px': [ATLAS, ATLAS], 'densityScale': round(scale, 3), 'bytes': save_webp(atlas, 'rocks_atlas_v1', 84, alpha=True)}
    cliffs = []
    for no in range(1, 21):
        c, rep = cliff(no, pc[no])
        cliffs.append(c)
        report['cliffs'].append(rep)
    catlas, crects = cliffs_atlas(cliffs)
    report['outputs']['cliffs_atlas_v1'] = {'px': [catlas.shape[1], catlas.shape[0]], 'bytes': save_webp(catlas, 'cliffs_atlas_v1', 82, alpha=True)}
    tiles = []
    for no in range(1, 5):
        out, mean, rep = tile(no)
        name = f'tex_rock_t{no:02d}_v2'
        report['outputs'][name] = {'px': [TILE, TILE], 'bytes': save_webp(out, name, 86)}
        tiles.append((no, name, mean))
        report['tiles'].append(rep)
    # 形の値（TypeScript）
    L = []
    L.append('// 生成物（npm run rocks:art = tools/rock-art.py）。手で編集しない。元は依頼 10（ChatGPT）の設定図 art-source/env/{rocks,cliffs,tiles}/。')
    L.append('// 決まりは docs/spec.md の 21.3（v0.22.0）。座標は m、y が上、+z が岩の前（正面図の側）、+x が正面図の右（右側面図の側）。')
    L.append('')
    L.append('export interface RockArt {')
    L.append('  id: string;')
    L.append("  size: 'S' | 'M' | 'L';")
    L.append('  tags: readonly string[];')
    L.append('  /** 見えている部分の幅（x）・奥行（z）・高さ（y）。3 つの図の平均にそろえた値（m） */')
    L.append('  w: number;')
    L.append('  d: number;')
    L.append('  h: number;')
    L.append('  /** 正面の上の線（-x → +x に 64 点）と、右側面の上の線（前 +z → 後ろ -z に 64 点）。高さ ÷ h */')
    L.append('  fp: readonly number[];')
    L.append('  sp: readonly number[];')
    L.append('  /** 平面の輪郭（地面から出ている所。塊ごと）: いちばん内側の点 c と、輪郭の点 [x, z, x, z, …]（x → z へ回る向き） */')
    L.append('  foot: readonly { c: readonly [number, number]; pts: readonly number[] }[];')
    L.append('  /** 図集（rocks_atlas_v1）の中の、正面・右側面・平面の図の範囲 [u0, v0, u1, v1]。正面と右側面は v0 が地面、平面は v0 が前 */')
    L.append('  front: readonly [number, number, number, number];')
    L.append('  side: readonly [number, number, number, number];')
    L.append('  top: readonly [number, number, number, number];')
    L.append('  /** 色の平均（0〜1。絵が届くまでの色） */')
    L.append('  mean: readonly [number, number, number];')
    L.append('}')
    L.append('')
    L.append('export const ROCK_ATLAS = \'rocks_atlas_v1\';')
    L.append('')
    L.append('export const ROCK_ART: readonly RockArt[] = [')
    for r in rocks:
        o = {'id': r['id'], 'size': r['size'], 'tags': r['tags'], 'w': r['w'], 'd': r['d'], 'h': r['h'], 'fp': r['fp'], 'sp': r['sp'], 'foot': r['foot'],
             'front': rects[(r['no'], 0)], 'side': rects[(r['no'], 1)], 'top': rects[(r['no'], 2)], 'mean': r['mean']}
        L.append(f'  {ts_num(o)},')
    L.append('];')
    L.append('')
    L.append('export interface CliffArt {')
    L.append('  id: string;')
    L.append('  tags: readonly string[];')
    L.append('  /** 左の端・右の端の高さ（m）。出口のわきの 2 つは、透明の側が 0 */')
    L.append('  edges: readonly [number, number];')
    L.append('  /** 上の線: 左 → 右（横 24m）に 256 点。地面からの高さ（m）。0 は何も無い所 */')
    L.append('  top: readonly number[];')
    L.append("  /** 出口の側（C-19 は右、C-20 は左）と、何も無い範囲 [始め, 終わり]（m） */")
    L.append("  exit: 'left' | 'right' | null;")
    L.append('  empty: readonly [number, number] | null;')
    L.append('  /** 図集（cliffs_atlas_v1）の中の範囲 [u0, v0, u1, v1]。g = 範囲の下の端から地面の線までの割合、hM = 範囲の高さ（m） */')
    L.append('  rect: readonly [number, number, number, number];')
    L.append('  g: number;')
    L.append('  hM: number;')
    L.append(f'  /** 凹凸（明るさから。{RELIEF_W} × {RELIEF_H}、上の行から。-127〜127 = 奥〜手前）。base64 の Int8Array */')
    L.append('  relief: string;')
    L.append('  mean: readonly [number, number, number];')
    L.append('}')
    L.append('')
    L.append("export const CLIFF_ATLAS = 'cliffs_atlas_v1';")
    L.append(f'export const CLIFF_M = {CLIFF_M};')
    L.append(f'export const CLIFF_RELIEF = [{RELIEF_W}, {RELIEF_H}] as const;')
    L.append('')
    L.append('export const CLIFF_ART: readonly CliffArt[] = [')
    for c in cliffs:
        o = {'id': c['id'], 'tags': c['tags'], 'edges': c['edges'], 'top': c['top'], 'exit': c['exit'], 'empty': c['empty'], 'rect': crects[c['no']], 'g': c['g'], 'hM': c['hM'],
             'relief': c['relief'], 'mean': c['mean']}
        L.append(f'  {ts_num(o)},')
    L.append('];')
    L.append('')
    L.append('/** 岩肌（1 枚 = 3m、端がつながる。平均の色は、細かな模様として掛ける時の割り算に使う） */')
    L.append('export const ROCK_TILES = {')
    for no, name, mean in tiles:
        L.append(f"  t{no:02d}: {{ file: '{name}', mean: {ts_num(mean)} }},")
    L.append('} as const;')
    L.append('')
    with open(OUT_TS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))
    with open(MEASURE, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    for k, v in report['outputs'].items():
        print(f'{k}: {v}')
    print('rocks 3view pass', sum(r['pass3view'] for r in report['rocks']), '/ 20; cliffs edges pass', sum(c['edgesPass'] for c in report['cliffs']), '/ 20')


if __name__ == '__main__':
    main()
