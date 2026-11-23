"""ガルドロスの皮の絵（区画に並べた 1 枚）と岩の模様を、設定図から作る。

入力:
  tools/out/galdros_mesh.json        … node tools/export-galdros-mesh.mjs が書く（区画の位置と目印の値）
  tools/out/art/galdros_side_skin.png … python3 tools/art/galdros_skin.py が書く（皮だけの絵）
  art-source/monster/galdros/galdros_left_v1.png … 岩の模様の元
出力（ゲームが読む）:
  public/assets/textures/galdros/galdros_hide_v1.webp
  public/assets/textures/galdros/galdros_rock_v1.webp

写し方: 体の各部は筒なので、筒を切り開いた長方形（区画）ごとに、設定図（右側面）の中の
「帯」を決めて写す。帯は 2 本の線（筒の上側の線と下側の線。脚なら前の線と後ろの線）で、
筒のまわりの角度に応じて 2 本の間を行き来する。見えている半分を筒の半周へ広げ、反対側は鏡写し。
設定図は 1 方向からの絵なので、真横から見た見え方が設定図に近くなり、上下の面は引き伸ばしになる。

使い方: python3 tools/art/galdros_bake.py [--debug]
"""
import json
import os
import sys
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MESH = os.path.join(ROOT, 'tools/out/galdros_mesh.json')
SKIN = os.path.join(ROOT, 'tools/out/art/galdros_side_skin.png')
LEFT = os.path.join(ROOT, 'art-source/monster/galdros/galdros_left_v1.png')
DST = os.path.join(ROOT, 'public/assets/textures/galdros')
os.makedirs(DST, exist_ok=True)

GROUND = 790.0
PX_PER_M = 269.0
# 角度の割り振り: 0 = 真横からの見え方のまま（上下の面は強く引き伸ばされる）、1 = 角度に比例（全体が均等）
WRAP = 0.5
# 設定図に描き込まれた陰影のうち、大きな明暗をどれだけ平らにするか（0 = そのまま）
DELIGHT = 0.45
# ゲームの照明の下で設定図の見え方に近づけるための、明るさの倍率と、彩度を下げる割合
GAIN = 1.2
DESAT = 0.12

# ---- 設定図（右側面、1672×941）の中の目印 ----
# 胴の軸に沿った位置 z (m) → 絵の x (px)
Z_TO_PX = [(-3.0, 100), (-0.98, 642), (1.18, 1222), (2.64, 1614)]  # 体つきを設定図に合わせた（D-041）ので、ほぼ 1 本の直線（268.5px/m）
# 胴・首・頭・尾の筒: 絵の x → 上の線の y、下の線の y
TRUNK = [
    (150, 555, 660), (215, 545, 657), (345, 520, 652), (505, 465, 628), (642, 300, 600), (800, 200, 590), (932, 150, 620), (1050, 130, 612),
    (1222, 170, 560), (1345, 240, 505), (1420, 225, 480), (1460, 255, 440), (1497, 285, 416), (1560, 315, 408), (1600, 335, 402), (1612, 345, 398),
]
# 下あご: 絵の x → 上の線（口の線の少し上）、下の線（あごの下）
JAW = [(1408, 385, 490), (1460, 385, 478), (1500, 385, 468), (1560, 385, 456), (1591, 385, 450)]
# 脚: 付け根からの割合 t（0 = 付け根、1 = ひじ・ひざ、2 = 足首）→ 前の線の点、後ろの線の点
LEG_FRONT = [(-0.12, 1345, 455, 1030, 470), (0, 1345, 480, 1030, 495), (1, 1350, 600, 1060, 600), (1.6, 1335, 670, 1085, 665), (2, 1330, 705, 1110, 700)]
LEG_HIND = [(-0.12, 800, 500, 500, 505), (0, 800, 530, 505, 535), (1, 770, 625, 532, 625), (1.6, 748, 680, 545, 680), (2, 742, 705, 542, 705)]
# 足: 足首からの前後 dz (m) → 絵の x。設定図の足は低く（85px ほど）爪が大半なので、
# 足首の少し上（FOOT_TOP）から地面までを、甲から側面へ写す。足の裏側は折り返す。
FOOT_FRONT = [(-0.44, 1120), (0, 1225), (0.63, 1410)]
FOOT_HIND = [(-0.44, 530), (0, 642), (0.63, 758)]
FOOT_TOP = 650.0


def interp(table, col, x):
    xs = np.array([r[0] for r in table], np.float32)
    ys = np.array([r[col] for r in table], np.float32)
    return np.interp(x, xs, ys)


def ribbon(chart, t):
    """区画の目印の値 t（配列）から、帯の 2 本の線の点 (Ax, Ay, Bx, By) を返す。"""
    kind = chart['kind']
    front = chart['meta'].get('front', 0) == 1
    if kind in ('tailTip', 'tailBase', 'body', 'head'):
        px = interp(Z_TO_PX, 1, t)
        return px, interp(TRUNK, 1, px), px, interp(TRUNK, 2, px)
    if kind == 'jaw':
        px = interp(Z_TO_PX, 1, t)
        return px, interp(JAW, 1, px), px, interp(JAW, 2, px)
    if kind.startswith('leg'):
        tb = LEG_FRONT if front else LEG_HIND
        return interp(tb, 1, t), interp(tb, 2, t), interp(tb, 3, t), interp(tb, 4, t)
    if kind.startswith('foot'):
        tb = FOOT_FRONT if front else FOOT_HIND
        px = interp(tb, 1, t)
        return px, np.full_like(px, FOOT_TOP), px, np.full_like(px, GROUND)
    if kind.startswith('lump'):
        m = chart['meta']
        px = interp(Z_TO_PX, 1, t)
        return px, np.full_like(px, GROUND - PX_PER_M * (m['cy'] + m['top'])), px, np.full_like(px, GROUND - PX_PER_M * (m['cy'] - m['bottom']))
    raise SystemExit('知らない区画: ' + kind)


def prepare_skin():
    img = cv2.imread(SKIN).astype(np.float32)
    if DELIGHT > 0:
        # 大きな明暗（上が明るく腹が暗い、など）をやわらげる。色あいと細かいしわの陰は残す。
        lum = img.mean(axis=2)
        low = cv2.GaussianBlur(lum, (0, 0), 38)
        target = float(np.median(low))
        img *= (np.power(target / np.maximum(low, 1), DELIGHT))[..., None]
    gray = img.mean(axis=2, keepdims=True)
    img = (img + (gray - img) * DESAT) * GAIN
    return np.clip(img, 0, 255)


def bake_hide(debug=False):
    data = json.load(open(MESH))
    size = data['atlas']['size']
    skin = prepare_skin()
    out = np.zeros((size, size, 3), np.float32)
    filled = np.zeros((size, size), bool)
    PAD = 7
    for c in data['atlas']['charts']:
        x0, y0, x1, y1 = c['rect']
        xs = np.arange(max(0, x0 - PAD), min(size, x1 + PAD))
        ys = np.arange(max(0, y0 - PAD), min(size, y1 + PAD))
        u = ((xs + 0.5 - x0) / (x1 - x0)) % 1.0
        v = np.clip((ys + 0.5 - y0) / (y1 - y0), 0, 1)
        t = np.interp(v, np.array(c['v'], np.float32), np.array(c['t'], np.float32)).astype(np.float32)
        a = -np.pi / 2 + 2 * np.pi * u
        d = (a - np.pi / 2 + np.pi) % (2 * np.pi) - np.pi  # 上（脚なら前）からの角度
        s = np.abs(d) / np.pi
        if c['kind'].startswith('foot'):
            # 甲（上）→ 側面の下端までで地面に着き、足の裏は折り返す
            g = np.where(s < 0.6, s / 0.6, 1 - (s - 0.6) / 0.4 * 0.6).astype(np.float32)
        else:
            g = ((1 - WRAP) * (1 - np.cos(np.pi * s)) / 2 + WRAP * s).astype(np.float32)
        ax, ay, bx, by = ribbon(c, t)
        mx = (ax[:, None] + (bx - ax)[:, None] * g[None, :]).astype(np.float32)
        my = (ay[:, None] + (by - ay)[:, None] * g[None, :]).astype(np.float32)
        tex = cv2.remap(skin, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        out[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1] = tex
        filled[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1] = True
    avg = out[filled].mean(axis=0)
    out[~filled] = avg
    # 絵を貼らない頂点が指す白い区画（左上）
    out[0:72, 0:72] = 255
    path = os.path.join(DST, 'galdros_hide_v1.webp')
    cv2.imwrite(path, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 86])
    b, g_, r = avg
    print('皮: %s  %d KB  平均の色 #%02x%02x%02x' % (os.path.relpath(path, ROOT), os.path.getsize(path) // 1024, int(r), int(g_), int(b)))
    if debug:
        cv2.imwrite(os.path.join(ROOT, 'tools/out/art/_hide_atlas_preview.jpg'), cv2.resize(np.clip(out, 0, 255).astype(np.uint8), (1024, 1024), interpolation=cv2.INTER_AREA))


def bake_rock():
    """岩の模様: 左側面の大きな岩板から、色むらを除いた細かい模様（欠け・面の境）だけを取り、つながる模様にする。"""
    img = cv2.imread(LEFT).astype(np.float32)
    x0, y0, n = 440, 250, 220
    crop = img[y0:y0 + n, x0:x0 + n]
    low = cv2.GaussianBlur(crop, (0, 0), 22, borderType=cv2.BORDER_REFLECT)
    ratio = crop / np.maximum(low, 1)
    # 端をつなぐ: 半分ずらした絵と、中央ほど元の絵が強くなるように混ぜる
    sh = np.roll(np.roll(ratio, n // 2, axis=0), n // 2, axis=1)
    yy, xx = np.mgrid[0:n, 0:n]
    edge = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy)).astype(np.float32)
    w = np.clip(edge / 26.0, 0, 1)[..., None]
    w = w * w * (3 - 2 * w)
    tile = ratio * w + sh * (1 - w)
    tile = cv2.resize(tile, (256, 256), interpolation=cv2.INTER_CUBIC)
    # 色みは頂点の色が持つので、ここは明るさの模様が主（色のゆらぎは少しだけ残す）
    gray = tile.mean(axis=2, keepdims=True)
    tile = gray * 0.75 + tile * 0.25
    tile = 1 + (tile - 1) * 1.25
    out = np.clip(tile * 228, 0, 255).astype(np.uint8)
    path = os.path.join(DST, 'galdros_rock_v1.webp')
    cv2.imwrite(path, out, [cv2.IMWRITE_WEBP_QUALITY, 90])
    print('岩: %s  %d KB' % (os.path.relpath(path, ROOT), os.path.getsize(path) // 1024))


if __name__ == '__main__':
    dbg = '--debug' in sys.argv
    bake_hide(dbg)
    bake_rock()
