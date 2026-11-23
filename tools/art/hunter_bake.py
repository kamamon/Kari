"""基準ハンターの体の絵（区画に並べた 1 枚）を、設定図から作る。

入力:
  tools/out/hunter_atlas.json … node tools/export-hunter-atlas.mjs が書く（区画の位置と目印の値）
  art-source/player/hunter_base_{front,back}_v1.png … 体（全身図の正面と背面）
  art-source/player/hunter_face_{front,left,back}_v1.png … 頭（顔と髪の近接図）
出力（ゲームが読む）:
  public/assets/textures/hunter/hunter_body_v1.webp（1024 四方）

写し方: 体の各部は筒。筒の前半分へ正面図、後ろ半分へ背面図を写す（頭だけは、横へ左真横の図も使う。右側は鏡写し）。
筒の各高さ（腕と脚は付け根からの距離）ごとに、設定図の中の「軸の点」と「横切る向き」を決め、
その線が人物の輪郭と交わる 2 点を自動で測って、筒の左右の端に合わせる（輪郭に合わせて伸び縮みする）。
設定図は腕を開いた姿、モデルの静止姿勢は腕を下ろした姿なので、腕は設定図の腕の向きに沿って写す。

使い方: python3 tools/art/hunter_bake.py [--debug]
"""
import json
import os
import sys
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'art-source/player')
DST = os.path.join(ROOT, 'public/assets/textures/hunter')
OUT_SIZE = 1024
# 全身図: 1px = 1.35mm、足の裏の行
MM = 0.00135
SOLE = 1362.0
# 体の横（前後の絵の境目）で、角度に比例した写し方をどれだけ混ぜるか（0 = 見えたまま。端が引き伸ばされる）
WRAP_BODY = 0.35
# 明るさの倍率（ゲームの照明の下で、設定図の見え方に近づける）
GAIN = 1.12
# 頭の輪の寸法（高さ、半幅、前、後ろ）。src/render/hunterBody.ts の headShape と同じ値（真上の図を写すのに使う）
HEAD_SHAPE = np.array([
    [1.565, 0.046, 0.08, 0.06], [1.578, 0.049, 0.083, 0.062], [1.592, 0.053, 0.085, 0.066], [1.606, 0.058, 0.086, 0.074], [1.62, 0.064, 0.085, 0.083], [1.632, 0.071, 0.083, 0.089],
    [1.644, 0.074, 0.081, 0.094], [1.656, 0.078, 0.084, 0.094], [1.668, 0.079, 0.092, 0.092], [1.68, 0.078, 0.097, 0.091], [1.695, 0.075, 0.098, 0.085], [1.71, 0.068, 0.094, 0.076],
    [1.725, 0.052, 0.085, 0.06], [1.738, 0.034, 0.066, 0.041], [1.747, 0.015, 0.036, 0.022], [1.7505, 0.005, 0.012, 0.008],
], np.float32)
# 真上の図: 髪の範囲の中心（px）と縮尺（px/m）。髪の端より内側だけを使う（端まで使うと、額の肌を拾う）。
TOP_CX, TOP_CY, TOP_SCALE = 628.0, 577.0, 3200.0


def load(name):
    img = cv2.imread(os.path.join(SRC, name)).astype(np.float32)
    lab = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    bg = np.median(lab[:30, :30].reshape(-1, 3), axis=0)
    # 人物 = 絵の端からつながった背景「以外」。生成りの服のように背景と色が近い所も、内側なら人物に入る。
    like = (np.abs(lab - bg).sum(axis=2) < 20).astype(np.uint8) * 255
    h, w = like.shape
    # 足元の影（彩度の低い灰色）も背景として扱う
    hsv = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2HSV)
    like[(hsv[..., 1] < 40) & (np.arange(h)[:, None] > h * 0.9) & (lab[..., 0] > 120)] = 255
    ff = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in [(1, 1), (w - 2, 1), (1, h // 2), (w - 2, h // 2), (w // 2, 1)]:
        if like[sy, sx] == 255:
            cv2.floodFill(like, ff, (sx, sy), 128)
    mask = like != 128
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    rows = np.where(mask[:200].sum(axis=1) > 6)[0]
    xs = np.where(mask[rows[0] + 40])[0]
    return {'img': img, 'mask': mask, 'cx': float(xs.min() + xs.max()) / 2}


def polyline(points):
    """[(t, x, y), ...] → t から (中心 x, 中心 y, 横切る向き nx, ny) を返す関数。横切る向きは絵の右側を向く。"""
    ts = np.array([p[0] for p in points], np.float32)
    xs = np.array([p[1] for p in points], np.float32)
    ys = np.array([p[2] for p in points], np.float32)

    def f(t):
        cx = np.interp(t, ts, xs)
        cy = np.interp(t, ts, ys)
        i = np.clip(np.searchsorted(ts, t, side='right') - 1, 0, len(ts) - 2)
        dx, dy = xs[i + 1] - xs[i], ys[i + 1] - ys[i]
        n = np.hypot(dx, dy)
        nx, ny = dy / n, -dx / n
        flip = nx < 0
        return cx, cy, np.where(flip, -nx, nx), np.where(flip, -ny, ny)

    return f


def vertical(cx, rowOf):
    return lambda t: (np.full_like(t, cx), rowOf(t), np.ones_like(t), np.zeros_like(t))


def edges(mask, cx, cy, nx, ny, cap, inset=3):
    """行ごとに、軸の点を含む（無ければいちばん近い）人物の区間の両端（軸からの距離 px）を測る。"""
    h, w = mask.shape
    caps = np.broadcast_to(np.asarray(cap, np.float32), cx.shape)  # 幅の上限は、行ごとに変えられる
    lo = np.zeros(len(cx), np.float32)
    hi = np.zeros(len(cx), np.float32)
    for i in range(len(cx)):
        cap = int(round(float(caps[i])))
        s = np.arange(-cap, cap + 1, dtype=np.float32)
        px = np.clip(np.round(cx[i] + nx[i] * s).astype(int), 0, w - 1)
        py = np.clip(np.round(cy[i] + ny[i] * s).astype(int), 0, h - 1)
        m = mask[py, px]
        if not m.any():
            lo[i], hi[i] = -cap * 0.5, cap * 0.5
            continue
        idx = np.where(m)[0]
        c = cap if m[cap] else idx[np.argmin(np.abs(idx - cap))]
        a = c
        while a > 0 and m[a - 1]:
            a -= 1
        b = c
        while b < len(m) - 1 and m[b + 1]:
            b += 1
        lo[i], hi[i] = s[a], s[b]
    k = 9
    pad = lambda v: np.pad(v, k // 2, mode='edge')
    med = lambda v: np.median(np.lib.stride_tricks.sliding_window_view(pad(v), k), axis=1)
    return med(lo) + inset, med(hi) - inset


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bake(debug=False):
    data = json.load(open(os.path.join(ROOT, 'tools/out/hunter_atlas.json')))
    size = data['size']
    F, Bk = load('hunter_base_front_v1.png'), load('hunter_base_back_v1.png')
    FF, FL, FB = load('hunter_face_front_v1.png'), load('hunter_face_left_v1.png'), load('hunter_face_back_v1.png')
    SL, SR = load('hunter_base_left_v1.png'), load('hunter_base_right_v1.png')
    FR, FT = load('hunter_face_right_v1.png'), load('hunter_face_top_v1.png')
    TL, TR = load('hunter_base_tpose_left_v1.png'), load('hunter_base_tpose_right_v1.png')
    row = lambda y: SOLE - y / MM
    lin = lambda t, t0, r0, t1, r1: r0 + (r1 - r0) * (t - t0) / (t1 - t0)
    mirror = lambda im, pts: [(t, 2 * im['cx'] - x, y) for (t, x, y) in pts]
    # 正面図での、人物の右腕・右脚（絵の左側）の軸。左側と背面図は、中心で折り返す。
    ARM = [(0, 415, 300), (0.29, 267, 478), (0.56, 118, 655), (0.68, 92, 748)]
    LEG = [(0, 468, 735), (0.43, 427, 1052), (0.87, 413, 1312)]
    FOOT = [(-0.075, 413, 1288), (0.19, 413, 1344)]
    head = lambda top, chin: (lambda t: lin(t, 1.565, chin, 1.75, top))

    def body(kind):
        """区画ごとの写す元: [(絵, 向き 'front'|'back'|'side', 軸の関数, 幅の上限)]"""
        if kind == 'head':
            # あごより下は、えりの布を拾わないよう、首の幅だけを写す
            narrow = lambda lo, hi: (lambda t: lo + (hi - lo) * sstep(1.562, 1.588, t))
            # 真横の図: あごの高さでは、首の後ろで立つえり（フード）まで人物の区間に入ってしまい、
            # ほおへ髪やえりの色が写る。軸を顔の側（x=560）へ寄せ、耳の高さより下では後ろをえり足までに限る。
            side_cap = lambda t: 190 + (440 - 190) * sstep(1.6, 1.66, t)
            # 右半分は右真横の図（左真横を反転して 12px ずらした位置に重なる）。てっぺんは真上の図（'top'）。
            return [(FF, 'front', vertical(650, head(40, 710)), narrow(115, 340)), (FL, 'side', vertical(560, head(50, 700)), side_cap),
                    (FR, 'sideR', vertical(705, head(38, 688)), side_cap), (FB, 'back', vertical(632, head(40, 705)), narrow(115, 340)), (FT, 'top', None, None)]
        if kind == 'torso':
            # 首（高さ 1.5m より上）は、えりや髪を拾わないよう、首の幅だけを写す
            cap = lambda t: 34 + (112 - 34) * sstep(1.5, 1.46, t)
            # 胴の横は、腕を水平に上げた真横の図から（肩より下だけ。上は腕とこぶしが重なる）
            return [(F, 'front', vertical(F['cx'], row), cap), (TL, 'side', vertical(520, row), 130), (TR, 'sideR', vertical(545, row), 130), (Bk, 'back', vertical(Bk['cx'], row), cap)]
        if kind == 'mantle':
            r = lambda t: lin(t, 1.53, 226, 1.335, 392)
            return [(F, 'front', vertical(F['cx'], r), 260), (Bk, 'back', vertical(Bk['cx'], r), 260)]
        if kind == 'skirt':
            r = lambda t: lin(t, 1.07, 572, 0.77, 800)
            return [(F, 'front', vertical(F['cx'], r), 172), (TL, 'side', vertical(520, r), 130), (TR, 'sideR', vertical(545, r), 130), (Bk, 'back', vertical(Bk['cx'], r), 172)]
        left = kind.endswith('L')
        if kind.startswith('foot'):
            # 足は、真横の図の長靴を写す（左足は左真横、右足は右真横）。かかと → つま先が絵の横、甲 → 靴底が絵の縦。
            # 外側と内側の両方へ同じ絵を回し、いちばん上（甲の中央）が絵の上端になる。
            if left:
                ax = lambda t: (594 - (t + 0.075) / 0.265 * 172, np.full_like(t, 1322), np.zeros_like(t), -np.ones_like(t))
                return [(SL, 'wrap', ax, 85)]
            ax = lambda t: (464 + (t + 0.075) / 0.265 * 172, np.full_like(t, 1322), np.zeros_like(t), -np.ones_like(t))
            return [(SR, 'wrap', ax, 85)]
        base = ARM if kind.startswith('arm') else LEG
        cap = 54 if kind.startswith('arm') else 74
        # 正面図では、人物の左（+X）が絵の右。背面図では、人物の左が絵の左。
        pf = mirror(F, [(t, x - 538 + F['cx'], y) for t, x, y in base]) if left else [(t, x - 538 + F['cx'], y) for t, x, y in base]
        pb = [(t, x - 538 + Bk['cx'], y) for t, x, y in base] if left else mirror(Bk, [(t, x - 538 + Bk['cx'], y) for t, x, y in base])
        out = [(F, 'front', polyline(pf), cap), (Bk, 'back', polyline(pb), cap)]
        if kind.startswith('leg'):
            # 脚の横は、真横の図から（左脚は左真横、右脚は右真横。内側は同じ絵の鏡写し）
            if left:
                out.insert(1, (SL, 'side', polyline([(0, 535, 735), (0.43, 552, 1052), (0.87, 552, 1312)]), 95))
            else:
                out.insert(1, (SR, 'sideR', polyline([(0, 534, 735), (0.43, 512, 1052), (0.87, 512, 1312)]), 95))
        return out

    out = np.zeros((size, size, 3), np.float32)
    filled = np.zeros((size, size), bool)
    PAD = 7
    for c in data['charts']:
        x0, y0, x1, y1 = c['rect']
        xs = np.arange(max(0, x0 - PAD), min(size, x1 + PAD))
        ys = np.arange(max(0, y0 - PAD), min(size, y1 + PAD))
        u = ((xs + 0.5 - x0) / (x1 - x0)) % 1.0
        v = np.clip((ys + 0.5 - y0) / (y1 - y0), 0, 1)
        t = np.interp(v, np.array(c['v'], np.float32), np.array(c['t'], np.float32)).astype(np.float32)
        a = -np.pi / 2 + 2 * np.pi * u  # 0 = +X（人物の左）、π/2 = 前、π = 右、-π/2 = 後ろ
        phi = np.abs((a - np.pi / 2 + np.pi) % (2 * np.pi) - np.pi)  # 真正面からの角度
        srcs = body(c['kind'])
        facings = [q[1] for q in srcs]
        split = 'side' in facings and 'sideR' in facings  # 左半分と右半分で、別の真横の図を使う
        # 横の絵が使える度合い（高さごと）。胴は肩より下だけ。横の絵が無い区画は 0。
        if 'side' in facings or 'sideR' in facings:
            avail = sstep(1.31, 1.26, t) if c['kind'] == 'torso' else np.ones_like(t)
        else:
            avail = np.zeros_like(t)
        top_w = sstep(1.702, 1.732, t) if 'top' in facings else np.zeros_like(t)
        deg = np.radians
        w2f, w3f = 1 - sstep(deg(80), deg(100), phi), 1 - sstep(deg(54), deg(72), phi)
        w2b, w3b = sstep(deg(80), deg(100), phi), sstep(deg(112), deg(132), phi)
        w3s = sstep(deg(54), deg(72), phi) * (1 - sstep(deg(112), deg(132), phi))
        A, P = avail[:, None], top_w[:, None]
        wrapv = ((1 - avail) * WRAP_BODY)[:, None]
        acc = np.zeros((len(ys), len(xs), 3), np.float32)
        wsum = np.zeros((len(ys), len(xs)), np.float32)
        for im, facing, axis, cap in srcs:
            if facing == 'top':
                # 真上の図: 鼻先が絵の下、人物の左が絵の右。頭の輪（幅・前・後ろ）を、絵の髪の範囲へ合わせる。
                rx, fr, bk = (np.interp(t, HEAD_SHAPE[:, 0], HEAD_SHAPE[:, k]) for k in (1, 2, 3))
                X = rx[:, None] * np.cos(a)[None, :]
                Z = np.where(np.sin(a)[None, :] >= 0, fr[:, None], bk[:, None]) * np.sin(a)[None, :]
                mx = (TOP_CX + X * TOP_SCALE).astype(np.float32)
                my = (TOP_CY + Z * TOP_SCALE).astype(np.float32)
                W = P * np.ones_like(a)[None, :]
            else:
                if facing == 'front':
                    # 横の絵がある所: 正面の絵を、ほおの手前（54 度）まで使う。目や口が、横の絵と二重に出ないようにする。
                    W = (1 - A) * w2f[None, :] + A * w3f[None, :]
                    fo = (1 + np.cos(a)) / 2
                    fl = 1 - np.clip(((a + 2 * np.pi) % (2 * np.pi)) / np.pi, 0, 1)
                elif facing == 'back':
                    W = (1 - A) * w2b[None, :] + A * w3b[None, :]
                    fo = (1 - np.cos(a)) / 2
                    fl = np.clip((2 * np.pi - ((a + 2 * np.pi) % (2 * np.pi))) / np.pi, 0, 1)
                elif facing == 'wrap':
                    W = np.ones((len(t), len(a)), np.float32)
                    fo = (1 + np.sin(a)) / 2  # 筒のいちばん上が、絵の上端
                    fl = fo
                else:
                    W = A * w3s[None, :]
                    if split:
                        W = W * ((np.cos(a) >= 0) if facing == 'side' else (np.cos(a) < 0))[None, :]
                    # 左真横の図は前が絵の左、右真横の図は前が絵の右
                    fo = (1 - np.sin(a)) / 2 if facing == 'side' else (1 + np.sin(a)) / 2
                    fl = fo
                W = W * (1 - P)
                if not (W > 0).any():
                    continue
                f = (fo[None, :] * (1 - wrapv) + fl[None, :] * wrapv).astype(np.float32)
                cx, cy, nx, ny = axis(t)
                lo, hi = edges(im['mask'], cx, cy, nx, ny, cap(t) if callable(cap) else cap, 7 if facing == 'wrap' else 3)
                sx = lo[:, None] + (hi - lo)[:, None] * f
                mx = (cx[:, None] + nx[:, None] * sx).astype(np.float32)
                my = (cy[:, None] + ny[:, None] * sx).astype(np.float32)
            if not (W > 0).any():
                continue
            tex = cv2.remap(im['img'], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            acc += tex * W[..., None]
            wsum += W
        acc /= np.maximum(wsum, 1e-4)[..., None]
        if c['kind'].startswith('foot'):
            acc *= 0.84  # 設定図の長靴の甲は、上からの光で明るく描かれている。ゲームでも上から光が当たるので、二重に明るくならないよう抑える
        out[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1] = acc
        filled[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1] = True
    out *= GAIN
    avg = out[filled].mean(axis=0)
    out[~filled] = avg
    out[0:72, 0:72] = 255  # 絵を貼らない頂点が指す白い区画
    small = cv2.resize(np.clip(out, 0, 255).astype(np.uint8), (OUT_SIZE, OUT_SIZE), interpolation=cv2.INTER_AREA)
    path = os.path.join(DST, 'hunter_body_v1.webp')
    cv2.imwrite(path, small, [cv2.IMWRITE_WEBP_QUALITY, 88])
    b, g, r = avg
    print('体: %s  %d KB  平均の色 #%02x%02x%02x' % (os.path.relpath(path, ROOT), os.path.getsize(path) // 1024, int(r), int(g), int(b)))
    if debug:
        cv2.imwrite(os.path.join(ROOT, 'tools/out/art/_hunter_atlas_preview.jpg'), cv2.resize(small, (760, 760)))


if __name__ == '__main__':
    bake('--debug' in sys.argv)
