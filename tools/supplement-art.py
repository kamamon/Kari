#!/usr/bin/env python3
"""ChatGPT の追加原画（Pull Request #5）と、受付ミナギの設定図から、ゲームで読む絵を作る（npm run supplement:art。v0.23.0）。

  art-source/icons/icon_*_v1.png            道具 4・ガルドロスの素材 10 のアイコン（RGBA。1254 四方）
  art-source/npc/ref_npc_*_v1.png           鍛冶（ロクハ）と商店（イサネ）の正面・背面（RGB。無地の背景）
  art-source/npc/minagi_full_v1.png         受付ミナギの全身（依頼 3）。minagi_bust_v1.png は会話の顔
  art-source/fields/field_NN_overview_v1.png 登録簿の狩場 20 の景色の原画（1536 × 1024）
  art-source/env/props/ref_fureki_prop_*_v1.png  採集草と採掘の露頭（RGB。無地の背景。v0.27.0 から、狩らない依頼の採取点）
  art-source/portraits/portrait_*_v1.png    会話の表情（RGBA。胸から上。ChatGPT の Pull Request #13。v0.29.0）
  art-source/npc/ref_npc_{minagi_back,senaki_front,senaki_back}_v1.png  ミナギの背面と、セナキの正面・背面（#13）
  art-source/story/event_story_*_v1.png     物語の場面の絵（1672 × 941。#13）
    → public/assets/icons/<名前>.webp            256 四方。透明の所の薄い残り（alpha 1〜15）を 0 に、外の余白を 1 割に
      public/assets/textures/npc/<名前>.webp      人の切り抜き（高さ 640px）。里に立てる板に貼る
      public/assets/portraits/<名前>.webp         会話の窓に出す、頭と肩の切り抜き（256 四方）
      public/assets/fields/<名前>.webp            狩場の景色（640 × 427）。図鑑と物語の欄に出す
      public/assets/story/<名前>.webp             物語の場面の絵（1280 × 720）。会話の窓の後ろに出す
      src/ui/artIndex.ts                          アイコン・顔・狩場の絵の名前（素材の id から）
      src/render/npcArt.ts                        人の板の大きさ（絵の縦横の比・足の位置・背丈）と、採取点の板の大きさ（PROP_ART）
      public/assets/textures/props/<名前>.webp    採取点の切り抜き（高さ 384px。v0.27.0）
      art-source/supplement_v1.measure.json       受け入れの確認で測った値

直すこと（絵は描き足さない）:
  アイコン  薄い不透明を 0 にして、絵のある範囲の外に 1 割の余白を付け、256 四方へ縮める。
  人        背景（縁の色の中央値）から Lab の色の差が 8 より小さく、縁につながる所を透明にする。囲まれた所も、広くて背景そのものの色なら透明に。
            足もとの床の影（色みが背景に近い、明るめの灰色）は消す。輪郭の 2px は、色の差でなめらかに透かす。
  狩場      縮めるだけ。
出力は手で編集しない。元の PNG を変えたら、もう一度これを走らせる。
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import color

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'art-source')
PUB = os.path.join(ROOT, 'public', 'assets')
MEASURE = os.path.join(ART, 'supplement_v1.measure.json')

# アイコン: 素材の id → 原画（ChatGPT の icons_generation.json の対応のまま）
ICONS = {
    'item.heal_tonic': 'icon_item_heal_v1',
    'item.bind_trap': 'icon_item_bind_trap_v1',
    'item.calm_orb': 'icon_item_calm_orb_v1',
    'item.whetstone': 'icon_item_whetstone_v1',
    'mat.galdros.shell_shard': 'icon_mat_galdros_shell_v1',
    'mat.galdros.hard_bone': 'icon_mat_bone_v1',
    'mat.galdros.bronze_vein': 'icon_mat_vein_v1',
    'mat.galdros.foreleg_plate': 'icon_mat_foreplate_v1',
    'mat.galdros.veined_shell': 'icon_mat_galdros_veined_shell_v1',
    'mat.galdros.tail_crystal': 'icon_mat_tail_v1',
    'mat.galdros.crystal_shell': 'icon_mat_galdros_crystal_shell_v1',
    'mat.galdros.bronze_lump': 'icon_mat_galdros_bronze_lump_v1',
    'mat.galdros.radiant_shell': 'icon_mat_galdros_radiant_shell_v1',
    'mat.galdros.pulse_core': 'icon_mat_core_v1',
}
ICON_PX = 256
ALPHA_CUT = 16

# 人: 名前 → (正面, 背面, 背丈 m。仮の値。docs/decisions.md の D-093)
NPCS = {
    'minagi': ('npc/minagi_full_v1', 'npc/ref_npc_minagi_back_v1', 1.64),
    'smith': ('npc/ref_npc_smith_front_v1', 'npc/ref_npc_smith_back_v1', 1.78),
    'merchant': ('npc/ref_npc_merchant_front_v1', 'npc/ref_npc_merchant_back_v1', 1.66),
    'senaki': ('npc/ref_npc_senaki_front_v1', 'npc/ref_npc_senaki_back_v1', 1.68),
}
NPC_H = 640
# 会話の顔（v0.29.0 から表情つき）: 名前 → 原画。どれも胸から上の 1086 × 1448 で、同じ切り方（頭の上から、幅の 8 割の正方形）。
# 平静は「話す人の名前」、表情は「名前_表情」。ミナギの平静は依頼 3 のバストアップ（無地の背景を切り抜く）、ほかは #13 の透明の絵
PORTRAITS = {
    'minagi': 'npc/minagi_bust_v1',
    'minagi_focus': 'portraits/portrait_minagi_focus_v1',
    'minagi_relief': 'portraits/portrait_minagi_relief_v1',
    'smith': 'portraits/portrait_rokuha_neutral_v1',
    'smith_thinking': 'portraits/portrait_rokuha_thinking_v1',
    'merchant': 'portraits/portrait_isane_neutral_v1',
    'merchant_relief': 'portraits/portrait_isane_relief_v1',
    'senaki': 'portraits/portrait_senaki_neutral_v1',
    'senaki_reflective': 'portraits/portrait_senaki_reflective_v1',
}
PORTRAIT_PX = 256
# 物語の場面の絵（#13）: 名前 → 原画。会話の窓の後ろに出す。遊べる場面（序章・第 1 章）で使う絵だけを作る。
# v0.39.0: 残りの 3 枚（old_records = 第 4 章、limited_lights = 第 7 章、homecoming = 終章）も、章の一覧の章の絵として出す（会話の場面は、章ができてから）
THUMB_W, THUMB_H = 480, 270
# v0.39.0: 看板の物語（ChatGPT の #18）の最初の目撃 1 枚も、追加決戦章の章の絵に（残りの 3 枚は art-source/story/ に置いたまま。章ができたら）
STORY_ART = ['event_story_arrival_board_v1', 'event_story_first_delivery_v1', 'event_story_old_records_v1', 'event_story_limited_lights_v1', 'event_story_homecoming_v1', 'event_thunder_first_sighting_v1']
STORY_W, STORY_H = 1280, 720
# 採取点の板（v0.27.0。狩らない依頼）: 名前 → (原画, 高さ m。仮の値)。切り抜き方は人と同じ
PROPS = {
    'herb': ('env/props/ref_fureki_prop_herb_v1', 0.85),
    'ore': ('env/props/ref_fureki_prop_ore_v1', 0.7),
}
PROP_H = 384

FIELD_W, FIELD_H = 640, 427


def cutout(path):
    """無地の背景の人の絵を切り抜く。rgb（0〜1）と alpha（0〜1）と、測った値を返す。"""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64) / 255
    lab = color.rgb2lab(rgb)
    border = np.concatenate([lab[:12].reshape(-1, 3), lab[-12:].reshape(-1, 3), lab[:, :12].reshape(-1, 3), lab[:, -12:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    de = np.sqrt(((lab - bg) ** 2).sum(axis=2))
    T = 8.0
    bgish = de < T
    lab_c, _ = ndimage.label(bgish)
    edge = set(np.unique(np.concatenate([lab_c[0], lab_c[-1], lab_c[:, 0], lab_c[:, -1]]))) - {0}
    border_bg = np.isin(lab_c, list(edge))
    fig = ~border_bg
    # 囲まれた背景の色の所: 広くて背景そのものの色（脚の間など）は透明に。小さな所（服の明るい点など）は人の一部
    enclosed = bgish & ~border_bg
    el, en = ndimage.label(enclosed)
    holes_cleared = 0
    if en:
        idx = np.arange(1, en + 1)
        sizes = ndimage.sum(enclosed, el, index=idx)
        means = ndimage.mean(de, el, index=idx)
        clear = [i + 1 for i, (s, m) in enumerate(zip(sizes, means)) if s > 0.0012 * de.size and m < 4]
        holes_cleared = len(clear)
        fig &= ~np.isin(el, clear)
    # 足もとの床の影: いちばん下の 8% の帯の、色みが背景に近い明るめの灰色
    ys = np.nonzero(fig.any(axis=1))[0]
    top, bottom = int(ys.min()), int(ys.max())
    band = np.zeros_like(fig)
    band[int(bottom - (bottom - top) * 0.08):] = True
    chroma = np.sqrt((lab[..., 1] - bg[1]) ** 2 + (lab[..., 2] - bg[2]) ** 2)
    cand = band & fig & (chroma < 6) & (lab[..., 0] > 38)
    # 外の背景につながっている所だけ（靴の明るい所のような、人の中の灰色は残す）
    sl, sn = ndimage.label(cand)
    touch = np.unique(sl[ndimage.binary_dilation(~fig, iterations=1) & cand])
    shadow = np.isin(sl, [t for t in touch if t != 0])
    shadow_px = int(shadow.sum())
    fig = fig & ~shadow
    # いちばん大きな塊だけを残す（小さな粒を除く）
    fl, fn = ndimage.label(fig)
    if fn > 1:
        sizes = ndimage.sum(fig, fl, index=np.arange(1, fn + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.002]
        fig = np.isin(fl, keep)
    # 輪郭の 2px を、色の差でなめらかに透かす
    soft = np.clip((de - 3.0) / (T + 4.0 - 3.0), 0, 1)
    inner = ndimage.binary_erosion(fig, iterations=1)
    alpha = np.where(inner, 1.0, np.where(fig, np.maximum(soft, 0.5), 0.0))
    # 縁の色から背景の色を抜く（明るい縁取りが出ないように）
    bg_rgb = color.lab2rgb(bg.reshape(1, 1, 3)).reshape(3)
    a3 = alpha[..., None]
    fixed = np.where(a3 > 0.05, (rgb - (1 - a3) * bg_rgb) / np.maximum(a3, 0.05), rgb)
    rgb = np.clip(fixed, 0, 1)
    ys, xs = np.nonzero(alpha > 0.5)
    m = {
        'px': [rgb.shape[1], rgb.shape[0]], 'bgLab': [round(float(v), 2) for v in bg],
        'borderDeltaE99': round(float(np.percentile(np.sqrt(((border - bg) ** 2).sum(1)), 99)), 2),
        'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'floorShadowPx': shadow_px, 'holesCleared': holes_cleared,
    }
    return rgb, alpha, m


def bleed(rgb, alpha, solid=0.95):
    """縁の半透明の所の色を、いちばん近い不透明の所の色にする（明るい背景の色が縁に残って、暗い所で白く光るのを防ぐ）"""
    hard = alpha >= solid
    if hard.all() or not hard.any():
        return rgb
    _, (iy, ix) = ndimage.distance_transform_edt(~hard, return_indices=True)
    out = rgb.copy()
    soft = ~hard
    out[soft] = rgb[iy[soft], ix[soft]]
    return out


def save_webp(arr_rgba, path, q=88):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr_rgba).save(path, 'WEBP', quality=q, method=6)
    return os.path.getsize(path)


def to_u8(rgb, alpha):
    return np.dstack([(rgb * 255).round(), (alpha * 255).round()]).astype(np.uint8)


def main():
    measure = {'icons': [], 'npcs': [], 'portraits': [], 'fields': [], 'outputs': {}}

    # ---- アイコン ----
    for item_id, name in ICONS.items():
        im = Image.open(os.path.join(ART, 'icons', name + '.png')).convert('RGBA')
        a = np.asarray(im).copy()
        alpha = a[..., 3]
        faint = int(((alpha > 0) & (alpha < ALPHA_CUT)).sum())
        a[..., 3] = np.where(alpha < ALPHA_CUT, 0, alpha)
        ys, xs = np.nonzero(a[..., 3] > 0)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        w, h = x1 - x0, y1 - y0
        pad_before = [int(x0), int(y0), int(a.shape[1] - x1), int(a.shape[0] - y1)]
        side = int(round(max(w, h) / 0.8))  # 外に 1 割ずつの余白
        canvas = np.zeros((side, side, 4), np.uint8)
        ox, oy = (side - w) // 2, (side - h) // 2
        canvas[oy:oy + h, ox:ox + w] = a[y0:y1, x0:x1]
        out = Image.fromarray(canvas).resize((ICON_PX, ICON_PX), Image.LANCZOS)
        arr = np.asarray(out).copy()
        arr[..., 3] = np.where(arr[..., 3] < 8, 0, arr[..., 3])
        b = save_webp(arr, os.path.join(PUB, 'icons', name + '.webp'), q=90)
        measure['icons'].append({'id': item_id, 'file': name, 'px': list(im.size), 'faintAlpha': faint, 'marginPx': pad_before,
                                 'marginPct': [round(v / im.size[0] * 100, 1) for v in pad_before], 'subjectPx': [int(w), int(h)]})
        measure['outputs'][f'icons/{name}'] = {'px': [ICON_PX, ICON_PX], 'bytes': b}

    # ---- 人（里に立てる板）----
    npc_meta = {}
    for key, (front, back, height) in NPCS.items():
        meta = {'height': height}
        for side, src in (('front', front), ('back', back)):
            if not src:
                continue
            rgb, alpha, m = cutout(os.path.join(ART, src + '.png'))
            x0, y0, x1, y1 = m['bbox']
            # 縦は絵のある範囲（頭の上 → 足の裏）、横は中心から左右に同じだけ（板の中心 = 人の中心）
            cx = (x0 + x1) / 2
            half = max(cx - x0, x1 - cx) + 6
            X0, X1 = int(max(0, cx - half)), int(min(rgb.shape[1], cx + half))
            Y0, Y1 = max(0, y0 - 4), min(rgb.shape[0], y1 + 3)
            crop = to_u8(rgb, alpha)[Y0:Y1, X0:X1]
            img = Image.fromarray(crop)
            s = NPC_H / img.size[1]
            img = img.resize((max(1, int(round(img.size[0] * s))), NPC_H), Image.LANCZOS)
            name = f'npc_{key}_{side}_v1'
            b = save_webp(np.asarray(img), os.path.join(PUB, 'textures', 'npc', name + '.webp'), q=86)
            # 足の裏 = 絵の下から何割の所か（板の下の端を、地面の少し下に置くため）
            foot = (Y1 - y1) / (Y1 - Y0)
            head = (y0 - Y0) / (Y1 - Y0)
            meta[side] = {'file': name, 'aspect': round(img.size[0] / img.size[1], 4), 'foot': round(foot, 4), 'head': round(head, 4)}
            measure['npcs'].append({'id': key, 'side': side, 'src': src, **m})
            measure['outputs'][f'textures/npc/{name}'] = {'px': list(img.size), 'bytes': b}
        npc_meta[key] = meta

    # ---- 会話の顔（胸から上の絵を、同じ切り方で: 頭の上の少し上から、幅の 8 割の正方形。横は頭の中心）----
    for key, src in PORTRAITS.items():
        path = os.path.join(ART, src + '.png')
        im = Image.open(path)
        if im.mode == 'RGBA':
            a = np.asarray(im).astype(np.float64) / 255
            rgb, alpha = a[..., :3], a[..., 3]
        else:
            rgb, alpha, _ = cutout(path)
            # 髪の先に残る背景の明るい色: 縁を 3px 削って、なめらかにしてから、縁の色を内側の色にする
            alpha = ndimage.gaussian_filter(ndimage.grey_erosion(alpha, size=(7, 7)), 1.0)
            rgb = bleed(rgb, alpha)
        rows = np.nonzero((alpha > 0.5).any(axis=1))[0]
        y0 = int(rows.min())
        s = int(round(alpha.shape[1] * 0.8))
        head = alpha[y0:y0 + int(s * 0.25)] > 0.5
        cols = np.nonzero(head.any(axis=0))[0]
        cx = (cols.min() + cols.max()) / 2
        top = y0 - int(s * 0.05)
        X0 = int(round(cx - s / 2))
        u8 = to_u8(rgb, alpha)
        pad = np.zeros((u8.shape[0] + 2 * s, u8.shape[1] + 2 * s, 4), np.uint8)
        pad[s:s + u8.shape[0], s:s + u8.shape[1]] = u8
        crop = pad[top + s:top + 2 * s, X0 + s:X0 + 2 * s]
        img = Image.fromarray(crop).resize((PORTRAIT_PX, PORTRAIT_PX), Image.LANCZOS)
        name = f'portrait_{key}_v1'
        b = save_webp(np.asarray(img), os.path.join(PUB, 'portraits', name + '.webp'), q=88)
        measure['portraits'].append({'id': key, 'src': src, 'cropPx': [X0, top, s]})
        measure['outputs'][f'portraits/{name}'] = {'px': [PORTRAIT_PX, PORTRAIT_PX], 'bytes': b}

    # ---- 採取点（v0.27.0）----
    measure['props'] = []
    prop_meta = {}
    for key, (src, height) in PROPS.items():
        rgb, alpha, m = cutout(os.path.join(ART, src + '.png'))
        x0, y0, x1, y1 = m['bbox']
        cx = (x0 + x1) / 2
        half = max(cx - x0, x1 - cx) + 6
        X0, X1 = int(max(0, cx - half)), int(min(rgb.shape[1], cx + half))
        Y0, Y1 = max(0, y0 - 4), min(rgb.shape[0], y1 + 3)
        img = Image.fromarray(to_u8(rgb, alpha)[Y0:Y1, X0:X1])
        sc = PROP_H / img.size[1]
        img = img.resize((max(1, int(round(img.size[0] * sc))), PROP_H), Image.LANCZOS)
        name = f'prop_{key}_v1'
        b = save_webp(np.asarray(img), os.path.join(PUB, 'textures', 'props', name + '.webp'), q=86)
        prop_meta[key] = {'file': name, 'height': height, 'aspect': round(img.size[0] / img.size[1], 4), 'foot': round((Y1 - y1) / (Y1 - Y0), 4), 'head': round((y0 - Y0) / (Y1 - Y0), 4)}
        measure['props'].append({'id': key, 'src': src, **m})
        measure['outputs'][f'textures/props/{name}'] = {'px': list(img.size), 'bytes': b}

    # ---- 狩場の景色 ----
    gen = json.load(open(os.path.join(ROOT, 'docs', 'source', 'chatgpt-supplement-20261125', 'fields', 'fields_generation.json'), encoding='utf-8'))
    names = {r['filename'].replace('.png', ''): r['name'] for r in gen['records']}
    bestiary = json.load(open(os.path.join(ROOT, 'public', 'data', 'bestiary.json'), encoding='utf-8'))
    known = {f['name'] for f in bestiary['fields']}
    field_art = {}
    for file, name in sorted(names.items()):
        if name not in known:
            raise SystemExit(f'登録簿に無い狩場: {name}（{file}）')
        im = Image.open(os.path.join(ART, 'fields', file + '.png')).convert('RGB')
        out = im.resize((FIELD_W, FIELD_H), Image.LANCZOS)
        b = save_webp(np.asarray(out), os.path.join(PUB, 'fields', file + '.webp'), q=80)
        field_art[name] = file
        measure['fields'].append({'name': name, 'file': file, 'px': list(im.size)})
        measure['outputs'][f'fields/{file}'] = {'px': [FIELD_W, FIELD_H], 'bytes': b}
    if len(field_art) != len(known):
        raise SystemExit(f'狩場の絵が {len(field_art)} 枚（登録簿は {len(known)}）')

    # ---- 物語の場面（v0.29.0）----
    measure['story'] = []
    for name in STORY_ART:
        im = Image.open(os.path.join(ART, 'story', name + '.png')).convert('RGB')
        out = im.resize((STORY_W, STORY_H), Image.LANCZOS)
        b = save_webp(np.asarray(out), os.path.join(PUB, 'story', name + '.webp'), q=80)
        measure['story'].append({'file': name, 'px': list(im.size)})
        measure['outputs'][f'story/{name}'] = {'px': [STORY_W, STORY_H], 'bytes': b}
        # 章の一覧の小さな絵（v0.39.0。一覧を開いた時に、大きな絵を 5 枚読まないように）
        os.makedirs(os.path.join(PUB, 'story', 'thumb'), exist_ok=True)
        th = im.resize((THUMB_W, THUMB_H), Image.LANCZOS)
        b = save_webp(np.asarray(th), os.path.join(PUB, 'story', 'thumb', name + '.webp'), q=78)
        measure['outputs'][f'story/thumb/{name}'] = {'px': [THUMB_W, THUMB_H], 'bytes': b}

    # ---- 書き出し ----
    ts = ['// tools/supplement-art.py の出力（npm run supplement:art）。手で編集しない。', '',
          '/** 素材・道具の id → アイコン（public/assets/icons/<名前>.webp。256 四方） */',
          'export const ITEM_ICONS: Readonly<Record<string, string>> = {']
    ts += [f"  '{k}': '{v}'," for k, v in ICONS.items()]
    ts += ['};', '', '/** 会話の顔（public/assets/portraits/<名前>.webp。256 四方の切り抜き） */',
           'export const PORTRAITS: Readonly<Record<string, string>> = {']
    ts += [f"  {k}: 'portrait_{k}_v1'," for k in PORTRAITS]
    ts += ['};', '', '/** 物語の場面の絵（public/assets/story/<名前>.webp。1280 × 720。v0.29.0） */',
           'export const STORY_ART: readonly string[] = [']
    ts += [f"  '{k}'," for k in STORY_ART]
    ts += ['];', '', '/** 狩場の名前（登録簿の fields）→ 景色の原画（public/assets/fields/<名前>.webp。640 × 427） */',
           'export const FIELD_ART: Readonly<Record<string, string>> = {']
    ts += [f"  '{k}': '{v}'," for k, v in field_art.items()]
    ts += ['};', '']
    with open(os.path.join(ROOT, 'src', 'ui', 'artIndex.ts'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(ts))
    ts = ['// tools/supplement-art.py の出力（npm run supplement:art）。手で編集しない。', '',
          '/** 里に立てる人の板の絵（public/assets/textures/npc/<file>.webp）。aspect = 幅 / 高さ、foot・head = 絵の下・上の端から、足の裏・頭の上までの割合 */',
          'export interface NpcSide { file: string; aspect: number; foot: number; head: number }',
          '/** height は背丈（m。仮の値）。back が無い人は、いつも正面を向ける */',
          'export interface NpcArt { height: number; front: NpcSide; back?: NpcSide }', '',
          'export const NPC_ART: Readonly<Record<string, NpcArt>> = ' + json.dumps(npc_meta, ensure_ascii=False) + ';', '',
          '/** 採取点の板の絵（v0.27.0。public/assets/textures/props/<file>.webp）。height は高さ（m。仮の値）、ほかは人の板と同じ */',
          'export interface PropArt extends NpcSide { height: number }',
          'export const PROP_ART: Readonly<Record<\'herb\' | \'ore\', PropArt>> = ' + json.dumps(prop_meta, ensure_ascii=False) + ';', '']
    with open(os.path.join(ROOT, 'src', 'render', 'npcArt.ts'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(ts))
    with open(MEASURE, 'w', encoding='utf-8') as f:
        json.dump(measure, f, ensure_ascii=False, indent=1)
    total = sum(v['bytes'] for v in measure['outputs'].values())
    print(f"アイコン {len(measure['icons'])}、人 {sum(1 for _ in measure['npcs'])} 枚、顔 {len(measure['portraits'])}、採取点 {len(measure['props'])}、狩場 {len(measure['fields'])}、場面 {len(measure['story'])}。合わせて {total / 1e6:.2f}MB")


if __name__ == '__main__':
    main()
