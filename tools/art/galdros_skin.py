"""ガルドロスの右側面の設定図から「皮だけの絵」を作る。

岩板・青銅色の縁・尾先の晶・爪・目・背景を取り除き、まわりの皮の色と細かい模様で埋める。
出力は tools/out/art/（中間物。配信しない）。次の tools/art/galdros_bake.py が読む。

使い方: python3 tools/art/galdros_skin.py
確認用の重ね絵: tools/out/art/galdros_side_classes.png（赤=岩 / 緑=皮 / 青=背景 / 黄=爪・目）
"""
import os
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'art-source/monster/galdros/galdros_right_v1.png')
OUT = os.path.join(ROOT, 'tools/out/art')
os.makedirs(OUT, exist_ok=True)

BG, SKIN, ROCK = 1, 2, 3

# 種（たね）: 各領域の内側に確実に入っている線。ここから色の境目まで広げる（watershed）。
ROCK_SEEDS = [
    # 背の甲
    [(700, 330), (800, 250), (1000, 180), (1200, 180), (1250, 210)], [(760, 320), (900, 300), (1000, 250), (1150, 220)], [(1050, 150), (1150, 150)],
    # 肩の板（上・下）
    [(1080, 290), (1250, 270), (1280, 300)], [(1090, 340), (1200, 340)], [(1160, 390), (1240, 380)], [(1200, 430), (1220, 440)],
    # 腰の板
    [(640, 400), (720, 380)], [(600, 440), (680, 440)], [(540, 490), (580, 470)],
    # 前脚の甲
    [(1180, 580), (1250, 590)], [(1210, 640), (1260, 630)],
    # 頭の甲
    [(1370, 250), (1480, 250), (1540, 285)], [(1400, 280), (1500, 290)],
    # 尾先の晶
    [(70, 625), (180, 600), (250, 560)], [(120, 650), (200, 640)], [(150, 570), (200, 550)],
]
SKIN_SEEDS = [
    [(830, 440), (980, 430), (1010, 500)], [(820, 560), (980, 590)], [(880, 380), (990, 370)],
    [(1330, 400), (1420, 440), (1440, 380)], [(1300, 480), (1380, 500)], [(1320, 340), (1335, 360)],
    [(1470, 360), (1560, 365)], [(1470, 430), (1560, 425)], [(1585, 415), (1590, 440)], [(1590, 345), (1600, 360)],
    [(1090, 500), (1130, 560), (1110, 640)], [(1330, 520), (1350, 600), (1330, 690)], [(1180, 700), (1330, 720)], [(1060, 470), (1090, 480)],
    [(640, 560), (700, 620), (640, 700)], [(560, 620), (600, 720)], [(760, 560), (790, 620)],
    [(330, 590), (480, 560)], [(360, 640), (460, 620)], [(520, 540), (545, 600)], [(480, 500), (500, 520)],
    [(790, 680), (840, 740)], [(1100, 680), (1130, 740)],
]
EYE = (1497, 326, 17)
GROUND_Y = 792


def classify(img):
    h, w = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    # 背景: 四隅の色に近く、端からつながっている所
    bgc = np.median(lab[:30, :30].reshape(-1, 3), axis=0)
    d = np.abs(lab - bgc).sum(axis=2)
    near = (d < 22).astype(np.uint8)
    # 影（足元の灰色）: 彩度が低く、地面の近く
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    shadow = ((hsv[..., 1] < 45) & (np.arange(h)[:, None] > 735)).astype(np.uint8)
    cand = ((near | shadow) * 255).astype(np.uint8)
    ff = cand.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3), (w // 2, 5), (w // 2, h - 5)]:
        if ff[sy, sx] == 255:
            cv2.floodFill(ff, mask, (sx, sy), 128)
    bg = ff == 128
    # 足の間の影（背景とつながっていない灰色）も背景にする
    bg |= (shadow == 1) & (np.arange(h)[:, None] > 760)
    bg = cv2.morphologyEx(bg.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)

    markers = np.zeros((h, w), np.int32)
    markers[cv2.erode(bg.astype(np.uint8), np.ones((5, 5), np.uint8)) == 1] = BG
    for line in ROCK_SEEDS:
        cv2.polylines(markers, [np.array(line, np.int32)], False, ROCK, 5)
    for line in SKIN_SEEDS:
        cv2.polylines(markers, [np.array(line, np.int32)], False, SKIN, 5)
    smooth = cv2.bilateralFilter(img, 9, 40, 9)
    cv2.watershed(smooth, markers)
    cls = markers.copy()
    cls[cls <= 0] = SKIN
    cls[bg] = BG
    rock = cls == ROCK
    # 青銅色の縁（赤み・黄みが強く明るい）は、岩の近くにある分を岩へ入れる
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    bronze = (b > 146.5) & (a > 133.5) & (L > 120)
    nearRock = cv2.dilate(rock.astype(np.uint8), np.ones((15, 15), np.uint8)) == 1
    rock |= bronze & nearRock & ~bg
    rock = cv2.morphologyEx(rock.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) == 1
    # 縁の青銅色が皮へ混ざらないよう、岩を少し太らせる
    rock = cv2.dilate(rock.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) == 1
    # 爪: 足元の、明るくて模様の少ない所
    yy = np.arange(h)[:, None]
    claw = (yy > 722) & (L > 138) & ~bg & ~rock
    claw = cv2.morphologyEx(claw.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    claw = cv2.dilate(claw, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) == 1
    eye = np.zeros((h, w), np.uint8)
    cv2.circle(eye, EYE[:2], EYE[2], 1, -1)
    # 取り残した青銅色の縁（岩板のまわり 60px 以内の、強い橙色）も除く。くちばしは岩板から遠いので残る。
    wide = cv2.dilate(rock.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (121, 121))) == 1
    rim = (b > 149) & (a > 134.5) & wide & ~rock & (np.arange(w)[None, :] < 1430)
    rim = cv2.dilate(rim.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) == 1
    other = (claw | (eye == 1) | rim) & ~bg
    return bg, rock & ~bg, other


def push_pull(color, valid, levels=10):
    """穴（valid=0）を、まわりの色をなめらかに広げて埋める。"""
    cs, ws = [color * valid[..., None]], [valid.astype(np.float32)]
    for _ in range(levels):
        c, w = cs[-1], ws[-1]
        if min(c.shape[:2]) < 2:
            break
        size = (max(1, c.shape[1] // 2), max(1, c.shape[0] // 2))
        cs.append(cv2.resize(c, size, interpolation=cv2.INTER_AREA))
        ws.append(cv2.resize(w, size, interpolation=cv2.INTER_AREA))
    mean = cs[0].reshape(-1, 3).sum(axis=0) / max(1e-6, float(ws[0].sum()))
    fill = np.broadcast_to(mean, cs[-1].shape).astype(np.float32)
    for i in range(len(cs) - 1, -1, -1):
        if fill.shape[:2] != cs[i].shape[:2]:
            fill = cv2.resize(fill, (cs[i].shape[1], cs[i].shape[0]), interpolation=cv2.INTER_LINEAR)
        w = ws[i][..., None]
        own = cs[i] / np.maximum(w, 1e-4)
        k = np.clip(w * 4, 0, 1)
        fill = own * k + fill * (1 - k)
    return fill


def splat_detail(detail, core, h, w, seed=7, size=72, step=30):
    """皮の細かい模様（元 − ぼかし）の小片を、皮の所から不規則に取って敷き詰める（穴埋め用の模様）。"""
    rng = np.random.default_rng(seed)
    ok = cv2.erode(core.astype(np.uint8), np.ones((size, size), np.uint8), anchor=(0, 0)) == 1  # 左上の角を基準に、小片がすべて皮に入る位置
    ys, xs = np.nonzero(ok[: h - size, : w - size])
    acc = np.zeros((h + size, w + size, 3), np.float32)
    wsum = np.zeros((h + size, w + size), np.float32)
    g = cv2.getGaussianKernel(size, size / 4.2)
    win = (g @ g.T).astype(np.float32)
    win /= win.max()
    for y in range(-size // 2, h, step):
        for x in range(-size // 2, w, step):
            j = int(rng.integers(len(ys)))
            sy, sx = int(ys[j]), int(xs[j])
            patch = detail[sy:sy + size, sx:sx + size]
            if rng.random() < 0.5:
                patch = patch[:, ::-1]
            oy, ox = y + int(rng.integers(-8, 9)) + size // 2, x + int(rng.integers(-8, 9)) + size // 2
            oy, ox = max(0, min(h, oy)), max(0, min(w, ox))
            acc[oy:oy + size, ox:ox + size] += patch * win[..., None]
            wsum[oy:oy + size, ox:ox + size] += win * win
    out = acc / np.sqrt(np.maximum(wsum, 1e-4))[..., None]
    return out[size // 2:size // 2 + h, size // 2:size // 2 + w]


def main():
    img = cv2.imread(SRC)
    h, w = img.shape[:2]
    bg, rock, other = classify(img)
    skin = ~(bg | rock | other)
    # 境目の混ざった色を使わないよう、皮を少し縮める
    core = cv2.erode(skin.astype(np.uint8), np.ones((7, 7), np.uint8)) == 1
    f = img.astype(np.float32)
    low = push_pull(f, core.astype(np.float32))
    # 細かい模様: 皮の「細部（元 − ぼかし）」の小片を、不規則に敷き詰める
    blur = push_pull(cv2.GaussianBlur(f * core[..., None], (0, 0), 7) / np.maximum(cv2.GaussianBlur(core.astype(np.float32), (0, 0), 7), 1e-3)[..., None], core.astype(np.float32))
    detail_fill = splat_detail(f - blur, core, h, w)
    soft = cv2.GaussianBlur(core.astype(np.float32), (0, 0), 3)[..., None]
    out = f * soft + (low + detail_fill * 0.9) * (1 - soft)
    out = np.clip(out, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, 'galdros_side_skin.png'), out)
    np.save(os.path.join(OUT, 'galdros_side_skinmask.npy'), core)
    # 確認用
    ov = img.copy()
    ov[rock] = (ov[rock] * 0.45 + np.array([0, 0, 255]) * 0.55).astype(np.uint8)
    ov[skin] = (ov[skin] * 0.7 + np.array([0, 200, 0]) * 0.3).astype(np.uint8)
    ov[bg] = (ov[bg] * 0.6 + np.array([255, 120, 0]) * 0.4).astype(np.uint8)
    ov[other] = (ov[other] * 0.4 + np.array([0, 255, 255]) * 0.6).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, 'galdros_side_classes.png'), ov)
    # 岩だけの絵（岩の模様づくり用）
    np.save(os.path.join(OUT, 'galdros_side_rockmask.npy'), rock)
    print('皮', int(skin.sum()), '岩', int(rock.sum()), '背景', int(bg.sum()), '爪・目', int(other.sum()))


main()
