#!/usr/bin/env python3
"""武器の設定図（正面など）から、仮モデルへ貼る絵と、形を組むための寸法を作る。

  python3 tools/art/weapon_bake.py

- 設定図の武器のまわりを切り出し、背景を「いちばん近い武器の色」で埋める（形の端が背景色を拾わないように）。
- 切り出し範囲・原点・縮尺と、輪郭から測った点（盾の外形、鎌の刃の上下の線）を
  src/render/weaponSheets.ts に書く。形を組む側（src/render/*.ts）は、この値を使う。
"""
import json
import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hunter_bake as hb  # 背景を縁から塗りつぶして切り出す load() を使う

ROOT = hb.ROOT
hb.SRC = os.path.join(ROOT, 'art-source/weapon')
DST = os.path.join(ROOT, 'public/assets/textures/weapons')
TS = os.path.join(ROOT, 'src/render/weaponSheets.ts')
GAIN = 1.08

# x0,y0,w,h: 切り出す範囲（設定図の px）/ cx: モデルの横 0 の px / py0: モデルの高さ 0 の px / m: 1px の長さ（m）
SHEETS = {
    # 断岳剣: 全長 1304px = 1.95m。原点は握り（柄頭の下端から 0.155m 上）
    'dangaku': dict(src='weapon_dangaku_front_v1.png', x0=392, y0=40, w=300, h=1332, cx=542, py0=1359 - 0.155 / (1.95 / 1304), m=1.95 / 1304, out=(256, 1024), file='dangaku_v1.webp'),
    # 護刃の剣: 全長 1291px = 1.0m。原点は握りの中央（py 1199）
    'gojinSword': dict(src='weapon_gojin_sword_front_v1.png', x0=442, y0=50, w=200, h=1322, cx=542, py0=1199, m=1.0 / 1291, out=(160, 1024), file='gojin_sword_v1.webp'),
    # 護刃の盾: 高さ 1109px = 0.6m。原点は盾の中央
    'gojinShieldFront': dict(src='weapon_gojin_shield_front_v1.png', x0=92, y0=152, w=900, h=1143, cx=542, py0=723.5, m=0.6 / 1109, out=(512, 640), file='gojin_shield_front_v1.webp'),
    'gojinShieldBack': dict(src='weapon_gojin_shield_back_v1.png', x0=92, y0=152, w=900, h=1143, cx=542, py0=723.5, m=0.6 / 1109, out=(512, 640), file='gojin_shield_back_v1.webp'),
    # 旋鎌: 全高 1312px = 1.95m。柄の中心 x=701.5。原点は下の握りの中央（py 1090）
    'senren': dict(src='weapon_senren_front_v1.png', x0=180, y0=50, w=565, h=1345, cx=701.5, py0=1090, m=1.95 / 1312, out=(512, 1216), file='senren_v1.webp'),
    # 長尖槍の槍: 正面の図。全長 1232px = 2.9m。原点は革巻きの握りの中央（py 1120）
    'chosensoLance': dict(src='weapon_chosenso_lance_front_v1.png', x0=505, y0=100, w=75, h=1265, cx=542, py0=1120, m=2.9 / 1232, out=(96, 1536), file='chosenso_lance_v1.webp'),
    # 長尖槍の大盾: 高さ 1147px = 1.1m。原点は盾の中央
    'chosensoShieldFront': dict(src='weapon_chosenso_shield_front_v1.png', x0=220, y0=114, w=646, h=1184, cx=542.5, py0=705.5, m=1.1 / 1147, out=(512, 944), file='chosenso_shield_front_v1.webp'),
    'chosensoShieldBack': dict(src='weapon_chosenso_shield_back_v1.png', x0=220, y0=114, w=646, h=1184, cx=542.5, py0=705.5, m=1.1 / 1147, out=(512, 944), file='chosenso_shield_back_v1.webp'),
    # 環弓: 横からの図。全高 1315px = 1.5m。原点は弓の上下の中央（握りの中央）、握りの厚みの中心が x=449
    'kankyuBow': dict(src='weapon_kankyu_bow_side_v1.png', x0=385, y0=40, w=265, h=1348, cx=449, py0=713.5, m=1.5 / 1315, out=(256, 1280), file='kankyu_bow_v1.webp', byColor=True),
    # 矢（長さ 1285px = 0.8m。原点は矢の中央）と矢筒（同じ図の右側。原点は筒の中央）
    'kankyuArrow': dict(src='weapon_kankyu_arrow_quiver_v1.png', x0=258, y0=45, w=112, h=1316, cx=313.5, py0=702.5, m=0.8 / 1285, out=(96, 1024), file='kankyu_arrow_v1.webp', byColor=True),
    'kankyuQuiver': dict(src='weapon_kankyu_arrow_quiver_v1.png', x0=530, y0=100, w=320, h=1270, cx=672, py0=865, m=0.8 / 1285, out=(256, 1024), file='kankyu_quiver_v1.webp', byColor=True),
    # 依頼 6（2026-11-25 に受け取った）。図の割合は依頼書の寸法と少し違うので、形は依頼書の寸法で組み、
    # 図は部品ごとに対応させて貼る（下の OTSUCHI_ART など。py0・m は、まっすぐ写す時の目安）。
    # 大槌: 正面 v2（全高 1301px = 1.45m。柄の中心 x=542.5。原点は下の握りの中央）と、真横 v2 の頭のまわり
    'otsuchiFront': dict(src='weapon_otsuchi_front_v2.png', x0=340, y0=44, w=405, h=1320, cx=542.5, py0=1153.5, m=1.45 / 1301, out=(320, 1024), file='otsuchi_front_v1.webp'),
    'otsuchiSide': dict(src='weapon_otsuchi_side_v2.png', x0=460, y0=44, w=165, h=300, cx=542.5, py0=1153.5, m=1.45 / 1301, out=(176, 320), file='otsuchi_side_v1.webp'),
    # 双剣の 1 本: 正面 v1（全高 1288px = 0.7m。握りの中心 x=542.5）
    'sokenFront': dict(src='weapon_soken_front_v1.png', x0=455, y0=58, w=175, h=1302, cx=542.5, py0=1198, m=0.7 / 1288, out=(144, 1024), file='soken_v1.webp'),
    # 太刀: 正面 v2（全高 1335px = 1.47m。柄の中心 x=540.5。原点は鍔のすぐ下の握り）
    'tachiFront': dict(src='weapon_tachi_front_v2.png', x0=490, y0=50, w=96, h=1346, cx=540.5, py0=1101, m=1.47 / 1335, out=(96, 1344), file='tachi_v1.webp'),
}

# 依頼 6 の図の、目で確かめた所（輪郭から自動では分けにくい所。px）
SOKEN_LANGET = dict(top=982, x0=524, x1=561)  # 鍔から刃へ伸びる、鋲 2 つの留め金
OTSUCHI_BAND = dict(x0=516, x1=575, rivets=[105, 155, 210, 260])  # 頭を縦に巻く帯金と、鋲の行


def runs(flags):
    """True が続く範囲 [(始め, 終わり), ...]（終わりを含む）"""
    out, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        if not f and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(flags) - 1))
    return out


def profile(mask):
    """行ごとの左端・右端・幅（px）。無い行は幅 0"""
    h = mask.shape[0]
    left, right, width = np.zeros(h, int), np.zeros(h, int), np.zeros(h, int)
    for y in range(h):
        xs = np.where(mask[y])[0]
        if len(xs):
            left[y], right[y], width[y] = xs[0], xs[-1], xs[-1] - xs[0] + 1
    rows = np.where(width > 0)[0]
    return left, right, width, int(rows[0]), int(rows[-1])


def request6(masks):
    """依頼 6 の 3 武器: 図の部品の境の行と、刃の輪郭の表。形を組む側（src/render/forgedWeapons.ts）が使う。"""
    out = []
    # 大槌（正面）: 頭は幅が最大の半分より広い行。頭の上は柄の突き出し（青銅の冠）。頭の下は口金、その下が柄。
    _, _, w, top, bottom = profile(masks['otsuchiFront'])
    head = max(runs(w > w.max() * 0.5), key=lambda r: r[1] - r[0])
    shaft = int(np.median(w[head[1] + 100:head[1] + 300]))
    y = head[1] + 1
    while w[y] > shaft + 3:
        y += 1
    collar = y - 1
    grips = [r for r in runs((w >= shaft + 3) & (w <= shaft + 8)) if collar < r[0] and r[1] - r[0] > 60]
    y = bottom
    while w[y - 1] > shaft + 1 or w[y] <= shaft + 1:
        y -= 1
    butt = y
    _, _, ws, _, _ = profile(masks['otsuchiSide'])
    sl, sr, _, stop, _ = profile(hb.load('weapon_otsuchi_side_v2.png')['mask'])
    sw = sr - sl + 1
    shead = max(runs(sw > sw.max() * 0.5), key=lambda r: r[1] - r[0])
    assert len(grips) == 2, grips
    fl, fr, _, _, _ = profile(masks['otsuchiFront'])
    o = dict(capTop=top, headTop=head[0], headBottom=head[1], collarBottom=collar, upperGrip=list(grips[0]), lowerGrip=list(grips[1]), buttTop=butt, bottom=bottom,
             headX=[int(fl[(head[0] + head[1]) // 2]), int(fr[(head[0] + head[1]) // 2])], shaftW=shaft, gripW=int(np.median(w[grips[0][0]:grips[0][1]])),
             collarW=[int(w[head[1] + 4]), int(np.median(w[head[1] + 12:collar - 4]))], capW=int(np.median(w[top + 6:head[0] - 2])), buttW=int(w[butt:bottom - 10].max()),
             band=OTSUCHI_BAND, side=dict(capTop=stop, headTop=shead[0], headBottom=shead[1], headX=[int(sl[(shead[0] + shead[1]) // 2]), int(sr[(shead[0] + shead[1]) // 2])]))
    out.append(('OTSUCHI_ART', '大槌の図（正面 v2 と真横 v2）で測った部品の行と幅（px）', o))

    def blade(key, langet=None):
        l, r, w, tip, _ = profile(masks[key])
        guard = max(runs(w > w[tip + 200:tip + 600].max() * 1.6), key=lambda q: q[1] - q[0])
        y = guard[1] + 1
        grip = int(np.median(w[guard[1] + 60:guard[1] + 160]))
        while w[y] > grip + 3:
            y += 1
        ferrule = y - 1
        _, bottom = tip, int(np.where(w > 0)[0][-1])
        y = bottom
        while w[y - 1] > grip + 2 or w[y] <= grip + 2:
            y -= 1
        pommel = y
        full = int(np.median(w[tip + 150:guard[0] - 60]))
        # 刃の表: 先から鍔へ [行, 刃の側（左）の端, 切っ先で欠けていない幅]。
        # 切っ先の斜めの線は、峰の側（右）の端がいちばん右へ出た行（角）より上。そこから上は、角の行の幅を使う。
        top = range(tip, tip + 200)
        corner = tip + int(np.argmax([r[y] for y in top]))
        rows = list(range(tip, guard[0] - 4, 6)) + [guard[0] - 4]
        table = [[y, int(l[y]), int(w[max(y, corner)])] for y in rows]
        o = dict(tip=tip, guardTop=guard[0], guardBottom=guard[1], ferruleBottom=ferrule, pommelTop=pommel, bottom=bottom, bladeW=full, gripW=grip,
                 guardX=[int(l[(guard[0] + guard[1]) // 2]), int(r[(guard[0] + guard[1]) // 2])], ferruleW=int(np.median(w[guard[1] + 2:ferrule])), pommelW=int(w[pommel:bottom - 4].max()),
                 cx=(int(l[guard[1] + 100]) + int(r[guard[1] + 100])) / 2, corner=corner, edge=table)
        if langet:
            o['langet'] = langet
        return o

    out.append(('SOKEN_ART', '双剣の図（正面 v1）で測った部品の行と幅、刃の表 [行, 刃の側の端, 幅]（px）', blade('sokenFront', SOKEN_LANGET)))
    out.append(('TACHI_ART', '太刀の図（正面 v2）で測った部品の行と幅、刃の表 [行, 刃の側の端, 幅]（px）', blade('tachiFront')))
    return out


def color_mask(img):
    """背景と色が違う画素。弓と弦で囲まれた内側のように、縁からの塗りつぶしが届かない所も背景として外せる。"""
    a = img.astype(np.int32)
    bg = np.median(a[:30, :30].reshape(-1, 3), axis=0)
    return np.abs(a - bg).sum(axis=2) > 36


def bake(key, s):
    im = hb.load(s['src'])
    img, mask = im['img'], im['mask']
    if s.get('byColor'):
        mask = color_mask(img)
    core = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)  # 端の、背景と混ざった 1px を捨てる
    _, labels = cv2.distanceTransformWithLabels((~core).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(core)
    lut = np.zeros((labels.max() + 1, 2), np.int32)
    lut[labels[ys, xs]] = np.stack([ys, xs], axis=1)
    src = lut[labels]
    filled = img[src[..., 0], src[..., 1]]
    crop = filled[s['y0']:s['y0'] + s['h'], s['x0']:s['x0'] + s['w']] * GAIN
    out = cv2.resize(np.clip(crop, 0, 255).astype(np.uint8), s['out'], interpolation=cv2.INTER_AREA)
    path = os.path.join(DST, s['file'])
    cv2.imwrite(path, out, [cv2.IMWRITE_WEBP_QUALITY, 90])
    flat = [int(round(v)) for v in (img[core].mean(axis=0) * GAIN)[::-1]]  # BGR → RGB
    print('%-17s %s  %d KB' % (key, os.path.relpath(path, ROOT), os.path.getsize(path) // 1024))
    return mask, flat


def main():
    os.makedirs(DST, exist_ok=True)
    masks, flats = {}, {}
    for key, s in SHEETS.items():
        masks[key], flats[key] = bake(key, s)

    lines = ['// 生成物（tools/art/weapon_bake.py）。手で編集しない。', '// 武器の設定図の切り出し範囲・原点・縮尺と、輪郭から測った点。単位は m（px は設定図の画素）。',
             "import type { ArtSheet } from './artMesh';", '', 'export const WEAPON_SHEETS = {']
    for key, s in SHEETS.items():
        lines.append("  %s: { tex: 'assets/textures/weapons/%s', x0: %d, y0: %d, w: %d, h: %d, cx: %s, py0: %s, mPerPx: %.9f, flat: [%d, %d, %d] }," % (
            key, s['file'], s['x0'], s['y0'], s['w'], s['h'], repr(round(s['cx'], 3)), repr(round(s['py0'], 3)), s['m'], *flats[key]))
    lines.append('} as const satisfies Record<string, ArtSheet>;')

    # 盾の外形（表から見て。x は右が +、y は上が +）
    for key, const, label in (('gojinShieldFront', 'GOJIN_SHIELD_OUTLINE', '護刃の盾'), ('chosensoShieldFront', 'CHOSENSO_SHIELD_OUTLINE', '長尖槍の大盾')):
        s = SHEETS[key]
        c, _ = cv2.findContours(masks[key].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        poly = cv2.approxPolyDP(max(c, key=cv2.contourArea), 6, True)[:, 0, :]
        pts = ', '.join('[%.4f, %.4f]' % ((x - s['cx']) * s['m'], (s['py0'] - y) * s['m']) for x, y in poly)
        lines += ['', '/** %sの外形（表から見た角の点。原点は盾の中央） */' % label, 'export const %s: readonly (readonly [number, number])[] = [%s];' % (const, pts)]

    # 槍: 穂先から石突へ [高さ, 正面の図での半幅, 真横の図での半幅]。2 枚の図は同じ高さに描かれている。
    s = SHEETS['chosensoLance']
    fm, sm = masks['chosensoLance'], hb.load('weapon_chosenso_lance_side_v1.png')['mask']
    rows = list(range(120, 470, 6)) + list(range(470, 1300, 46)) + list(range(1300, 1351, 5)) + [1350]
    lance = []
    for y in rows:
        wf, ws = int(fm[y].sum()), int(sm[min(y, 1349)].sum())
        if y < 370:
            ws = max(ws, 3)  # 真横の図は、穂先のいちばん先が細すぎて欠ける
        lance.append('[%.4f, %.4f, %.4f]' % ((s['py0'] - y) * s['m'], wf * s['m'] / 2, max(ws, 4) * s['m'] / 2))
    lines += ['', '/** 長尖槍の槍。穂先から石突へ [高さ, 正面の図での半幅, 真横の図での半幅]。原点は握りの中央 */',
              'export const CHOSENSO_LANCE: readonly (readonly [number, number, number])[] = [', '  ' + ', '.join(lance) + ',', '];']

    # 鎌の刃: 刃先から根元へ、[z, 上の端の高さ, 下の端の高さ]。柄と金具（x >= 688px）は含めない。
    s = SHEETS['senren']
    m = masks['senren'][:240]
    cols = np.where(m[:, :688].any(axis=0))[0]
    stations = []
    for x in [int(cols[0])] + list(range(int(cols[0]) + 8, 686, 16)) + [686]:
        rows = np.where(m[:, x])[0]
        stations.append('[%.4f, %.4f, %.4f]' % ((x - s['cx']) * s['m'], (s['py0'] - rows[0]) * s['m'], (s['py0'] - rows[-1]) * s['m']))
    lines += ['', '/** 旋鎌の刃の輪郭。刃先から根元へ [z, 上の端（峰）の高さ, 下の端（刃）の高さ]。原点は下の握り */',
              'export const SENREN_BLADE: readonly (readonly [number, number, number])[] = [', '  ' + ', '.join(stations) + ',', '];', '']
    # 環弓: 上から下へ [高さ, 厚みの中心の前後位置（図のまま）, 厚みの半分, 幅の半分]。弦と輪は含めない。
    side, front = SHEETS['kankyuBow'], dict(cx=542, py0=709.5, m=1.5 / 1337)  # 正面の図は全高 1337px
    so = color_mask(hb.load(side['src'])['img'])
    fm = hb.load('weapon_kankyu_bow_front_v1.png')['mask']

    def first_run(row):
        xs = np.where(row)[0]
        end = xs[0]
        for x in xs[1:]:
            if x > end + 2:
                break
            end = x
        return int(xs[0]), int(end)

    def thick(y):  # 横の図での厚み（px）。輪と留め金が重なる高さは、上下からつなぐ
        if 505 <= y <= 615:
            return np.interp(y, [505, 615], [thick(500), thick(620)])
        a, b = first_run(so[y])
        return min(b - a + 1, 34 if (y < 125 or y > 1310) else 62)

    def width(yf):  # 正面の図での幅（px）
        if 500 <= yf <= 615:
            return np.interp(yf, [500, 615], [width(495), width(620)])
        xs = np.where(fm[int(round(yf))])[0]
        return min(len(xs), 60) if len(xs) else 28

    bow = []
    for y in list(range(58, 1370, 12)) + [1369]:
        xb = first_run(so[y])[0]
        t = thick(y)
        ym = (side['py0'] - y) * side['m']
        w = width(front['py0'] - ym / front['m'])
        bow.append('[%.4f, %.4f, %.4f, %.4f]' % (ym, (xb + t / 2 - side['cx']) * side['m'], t * side['m'] / 2, w * front['m'] / 2))
    lines += ['/** 環弓の本体。上から下へ [高さ, 厚みの中心の前後位置（図のまま。-Z が弓の背、+Z が弦の側）, 厚みの半分, 幅の半分] */',
              'export const KANKYU_BOW: readonly (readonly [number, number, number, number])[] = [', '  ' + ', '.join(bow) + ',', '];',
              '/** 環弓の図での、弦の前後位置と、輪の中心（高さ・前後位置）。図のままの値 */',
              'export const KANKYU_ART = { stringZ: %.4f, ringY: %.4f, ringZ: %.4f } as const;' % ((626.5 - side['cx']) * side['m'], (side['py0'] - 560) * side['m'], (470 - side['cx']) * side['m'])]
    for name, label, o in request6(masks):
        print('%s %s' % (name, {k: v for k, v in o.items() if k != 'edge'}))
        lines += ['', '/** %s */' % label, 'export const %s = %s as const;' % (name, json.dumps(o, ensure_ascii=False, separators=(', ', ': ')))]
    lines.append('')
    with open(TS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('寸法: %s（盾の角 %d 点、鎌の刃 %d 点）' % (os.path.relpath(TS, ROOT), len(poly), len(stations)))


if __name__ == '__main__':
    main()
