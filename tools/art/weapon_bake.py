#!/usr/bin/env python3
"""断岳剣の設定図（正面）から、剣の形へ貼る絵を作る。

  python3 tools/art/weapon_bake.py

設定図の剣のまわりを切り出し、背景を「いちばん近い剣の色」で埋める（形の端が背景色を拾わないように）。
切り出す範囲と縮尺は src/render/heavyBlade.ts の ART と同じ値にする。
"""
import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hunter_bake as hb  # 背景を縁から塗りつぶして人物（ここでは剣）を切り出す load() を使う

ROOT = hb.ROOT
hb.SRC = os.path.join(ROOT, 'art-source/weapon')
DST = os.path.join(ROOT, 'public/assets/textures/weapons')
# 切り出す範囲（設定図の px）。剣の中心 x=542、全長 1304px = 1.95m。
X0, Y0, W, H = 392, 40, 300, 1332
OUT_W, OUT_H = 256, 1024
GAIN = 1.08


def main():
    im = hb.load('weapon_dangaku_front_v1.png')
    img, mask = im['img'], im['mask']
    mask = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)  # 端の、背景と混ざった 1px を捨てる
    # 背景の画素を、いちばん近い剣の画素の色にする
    _, labels = cv2.distanceTransformWithLabels((~mask).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.where(mask)
    lut = np.zeros((labels.max() + 1, 2), np.int32)
    lut[labels[ys, xs]] = np.stack([ys, xs], axis=1)
    src = lut[labels]
    filled = img[src[..., 0], src[..., 1]]
    crop = filled[Y0:Y0 + H, X0:X0 + W] * GAIN
    out = cv2.resize(np.clip(crop, 0, 255).astype(np.uint8), (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)
    path = os.path.join(DST, 'dangaku_v1.webp')
    cv2.imwrite(path, out, [cv2.IMWRITE_WEBP_QUALITY, 90])
    print('断岳剣: %s  %d KB' % (os.path.relpath(path, ROOT), os.path.getsize(path) // 1024))


if __name__ == '__main__':
    main()
