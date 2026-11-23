#!/usr/bin/env python3
"""武器の設定図（正面など）から、仮モデルへ貼る絵と、形を組むための寸法を作る。

  python3 tools/art/weapon_bake.py

- 設定図の武器のまわりを切り出し、背景を「いちばん近い武器の色」で埋める（形の端が背景色を拾わないように）。
- 切り出し範囲・原点・縮尺と、輪郭から測った点（盾の外形、鎌の刃の上下の線）を
  src/render/weaponSheets.ts に書く。形を組む側（src/render/*.ts）は、この値を使う。
"""
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
}


def bake(key, s):
    im = hb.load(s['src'])
    img, mask = im['img'], im['mask']
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
    s = SHEETS['gojinShieldFront']
    c, _ = cv2.findContours(masks['gojinShieldFront'].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    poly = cv2.approxPolyDP(max(c, key=cv2.contourArea), 6, True)[:, 0, :]
    pts = ', '.join('[%.4f, %.4f]' % ((x - s['cx']) * s['m'], (s['py0'] - y) * s['m']) for x, y in poly)
    lines += ['', '/** 護刃の盾の外形（表から見た角の点。原点は盾の中央） */', 'export const GOJIN_SHIELD_OUTLINE: readonly (readonly [number, number])[] = [%s];' % pts]

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
    with open(TS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('寸法: %s（盾の角 %d 点、鎌の刃 %d 点）' % (os.path.relpath(TS, ROOT), len(poly), len(stations)))


if __name__ == '__main__':
    main()
