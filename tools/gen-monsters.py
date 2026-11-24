#!/usr/bin/env python3
"""大型 11 種（登録簿の 02〜12）を遊べるモンスターにするデータを作る（npm run monsters:gen。v0.17.0）。

出力（手で編集しない。直す時は、このファイルを直して走らせ直す）:
  public/data/monsters/<key>.json      体・部位・肉質・AI
  public/data/actions/<key>.json       技（構え・攻撃・後隙、根元の動き、判定の時間枠、飛び道具）
  public/data/tracks/<key>.json        判定の形の軌道（カプセル）
  public/data/curves_creatures.json    技で進む距離の曲線
  public/data/quests_creatures.json    依頼（種ごとに初級 1 件）
  public/data/items_creatures.json     素材（登録簿の素材 4 つ）
  public/data/loot_creatures.json      剥ぎ取り・捕獲・部位破壊の表
  public/data/shop.json                の sell のうち、mat.<key>. の行（ほかの行は変えない）
  public/data/content.json             の files に、上のファイルを足す（既にあれば変えない）
  public/data/bestiary.json            の 11 種の state・stateNote（ほかの値は変えない）
  docs/asset-manifest.json             の model.monster.<key> と tex.monster.<key>.side の行
  src/render/creaturePlans.ts          見た目の設計図（形は原画の px。src/render/creaturePlan.ts の型）

決まり:
  - 技は、登録簿の「構え→攻撃」4 つ（左右のあるものは 2 つ）と、咆哮（発見・怒り）。D-053 の 20〜50 動作には届かない（仮）。
  - 形の座標は原画の px（右側面。頭が右）。z = (px - origin.x) × scale、y = (origin.y - py) × scale、x は m（+ が左）。
  - 大きさは、登録簿の全長のおよそ 0.68 倍（ガルドロスと同じ比。狩人の武器が頭へ届くように）。
  - 数値（体力・威力・時間）は、どれも机上の値。人が遊んで確かめていない。
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')


def r3(v):
    return round(v + 0.0, 3)


class Sp:
    """1 種の座標の変換（原画の px → モンスターの座標 m）。"""

    def __init__(self, key, scale, origin):
        self.key, self.s, self.ox, self.gy = key, scale, origin[0], origin[1]

    def m(self, px, py, x=0.0):
        return [r3(x), r3((self.gy - py) * self.s), r3((px - self.ox) * self.s)]

    def L(self, px):
        return px * self.s


def unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return [r3(c / n) for c in v]


# ---------------------------------------------------------------------------------------------
# 技の部品
# ---------------------------------------------------------------------------------------------

def track(tid, radius, length, keys):
    """keys: [(t, grip[x,y,z], dir[x,y,z])]。from 0 〜 to length のカプセル。"""
    return {'id': tid, 'radius': radius, 'from': 0, 'to': length, 'keys': [{'t': t, 'grip': [r3(c) for c in g], 'dir': unit(d)} for t, g, d in keys]}


def hit(wid, t0, t1, trk, dmg, reaction='knockdown', kind='blunt', guard=True, cost=30, status=None):
    h = {'id': wid, 'from': t0, 'to': t1, 'shapeTrack': trk, 'damageType': kind, 'damageCoefficient': 1.0, 'maxHitsPerTarget': 1, 'hitstopTicks': 0,
         'baseDamage': dmg, 'guardable': guard, 'guardCost': cost, 'reaction': reaction}
    if status:
        h['status'] = {'kind': status[0], 'power': status[1]}
    return h


def hazard(tick, count, spread, radius, warn, active, dmg, reaction, origin, look, peak=4, pattern=None, status=None):
    h = {'tick': tick, 'count': count, 'spread': spread, 'radius': radius, 'warnTicks': warn, 'activeTicks': active, 'baseDamage': dmg, 'reaction': reaction,
         'origin': [r3(c) for c in origin], 'peak': peak, 'look': look}
    if pattern:
        h['pattern'] = pattern
    if status:
        h['status'] = {'kind': status[0], 'power': status[1]}
    return h


def move(name, dur, startup, active, anim, *, side=None, hits=(), tracks=(), hazards=(), curve=None, dirDeg=None, turn=None, sounds=(), vfx=(), slamTrack=None, ai=None, amp=None):
    """技 1 つ。startup = 攻撃の始まり、active = 攻撃の終わり（tick）。curve = (距離 m, 始め, 終わり)。"""
    return dict(name=name, dur=dur, startup=startup, active=active, anim=anim, side=side, hits=list(hits), tracks=list(tracks), hazards=list(hazards), curve=curve,
                dirDeg=dirDeg, turn=turn, sounds=list(sounds), vfx=list(vfx), slamTrack=slamTrack, ai=ai, amp=amp)


def ai(minD, maxD, maxA, weight, minA=None, side=None, cd=None, clear=None):
    c = {'minDist': minD, 'maxDist': maxD, 'maxAngleDeg': maxA, 'weight': weight}
    if minA is not None:
        c['minAngleDeg'] = minA
    if side:
        c['side'] = side
    if cd:
        c['cooldownTicks'] = cd
    if clear:
        c['clearAhead'] = clear
    return c


def part(pid, name, mat, hz, shapes, *, broken=None, elem=0.2, dur=None, flinch=(160, 60, 45, False)):
    p = {'id': pid, 'name': name, 'hitzone': {'cut': hz[0], 'blunt': hz[1], 'shot': hz[2]}}
    if broken:
        p['brokenHitzone'] = {'cut': broken[0], 'blunt': broken[1], 'shot': broken[2]}
    p['elementZone'] = elem
    p['breakDurability'] = dur
    p['material'] = mat
    fl = {'threshold': flinch[0], 'growth': flinch[1], 'ticks': flinch[2]}
    if flinch[3]:
        fl['topple'] = True
    p['flinch'] = fl
    p['shapes'] = [{'a': a, 'b': b, 'r': r} if b is not None else {'a': a, 'r': r} for a, b, r in shapes]
    return p


def both(fn):
    """左右の 2 本（+x と -x）"""
    return [fn(1), fn(-1)]


# ---------------------------------------------------------------------------------------------
# 種ごとの定義
# ---------------------------------------------------------------------------------------------
SPECIES = []

# ---- 02 帆角獣 セルヴァルク（四足軽獣。風）----
S = Sp('selvark', 0.00372, (820, 995))
SPECIES.append(dict(
    sp=S, no=2, name='帆角獣 セルヴァルク', frame='quad', rig='quadruped_light',
    plan=dict(
        spine=[[40, 690, 3, 3, 3], [120, 625, 9, 9, 9], [230, 580, 14, 14, 14], [380, 520, 24, 24, 24], [500, 470, 38, 40, 36], [600, 525, 95, 95, 85],
               [800, 535, 95, 115, 90], [1000, 530, 100, 115, 95], [1090, 470, 70, 80, 70], [1150, 380, 52, 55, 50], [1200, 300, 48, 50, 48], [1255, 300, 55, 50, 45], [1305, 352, 20, 20, 22]],
        roles='-ttttbbbnnnh-', root=6,
        legs=[
            dict(group='F', attach=7, pts=[[1050, 600, 0.30], [1110, 790, 0.30], [1150, 925, 0.30], [1185, 985, 0.30]], r=[46, 25, 17, 14], mirror=True, phase=0.0, foot=[48, 26]),
            dict(group='H', attach=5, pts=[[600, 590, 0.30], [520, 760, 0.30], [600, 925, 0.30], [630, 985, 0.30]], r=[62, 28, 18, 14], mirror=True, phase=0.5, foot=[48, 26]),
        ],
        extras=[
            dict(kind='sheet', bone='own:crest', own=dict(name='crest', at=[1190, 300], parent='spine:11'), mirror=True, x=0.16, tilt=0.3, thick=0.03, ch='crest', part='crest',
                 pts=[[1210, 300], [1130, 335], [700, 390], [640, 270], [740, 110], [920, 20], [1060, 15], [1190, 28], [1270, 100], [1290, 180], [1245, 270]]),
            dict(kind='blob', bone='spine:11', c=[1258, 290], r=[18, 14, 0.04], mirror=True, x=0.15, shade=0.25),
        ],
        stride=1.9, lift=0.22,
    ),
    stats=dict(hp=1500, bodyRadius=0.9, turn=110, moveSpeed=3.4, approach=(4.0, 50), collision=[(0.0, 0.75), (1.0, 0.6), (-0.9, 0.6)],
               discover=(18, 140, 6), rage=(380, 1800, 1.3, 1.15, 0.6), cooldown=(40, 85)),
    parts=lambda s: [
        part('head', '頭', 'hide', (0.75, 0.7, 0.65), [(s.m(1210, 300), s.m(1300, 350), 0.24)], flinch=(140, 50, 45, False)),
        part('crest_l', '左角膜', 'hide', (0.8, 0.6, 0.75), [(s.m(1150, 330, 0.3), s.m(760, 380, 0.4), 0.32)], broken=(0.9, 0.7, 0.85), dur=170, flinch=(130, 50, 40, False)),
        part('crest_r', '右角膜', 'hide', (0.8, 0.6, 0.75), [(s.m(1150, 330, -0.3), s.m(760, 380, -0.4), 0.32)], broken=(0.9, 0.7, 0.85), dur=170, flinch=(130, 50, 40, False)),
        part('hindleg', '後脚の腱鞘', 'hide', (0.6, 0.55, 0.5), [(s.m(600, 600, 0.3), s.m(560, 900, 0.3), 0.17), (s.m(600, 600, -0.3), s.m(560, 900, -0.3), 0.17)], dur=200, broken=(0.7, 0.65, 0.6), flinch=(200, 70, 120, True)),
        part('tail', '尾先', 'hide', (0.55, 0.45, 0.5), [(s.m(380, 520), s.m(110, 630), 0.13)], dur=140, broken=(0.65, 0.55, 0.6)),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(620, 525), s.m(1000, 530), 0.42), (s.m(1090, 470), s.m(1190, 320), 0.22)]),
        part('foreleg', '前脚', 'hide', (0.5, 0.5, 0.4), [(s.m(1050, 610, 0.3), s.m(1150, 925, 0.3), 0.15), (s.m(1050, 610, -0.3), s.m(1150, 925, -0.3), 0.15)], flinch=(220, 70, 120, True)),
    ],
    moves=lambda s: [
        move('roar', 90, 90, 90, 'roar', sounds=[(10, 'beast_cry')]),
        *[move(f'hop_kick_{"l" if sd > 0 else "r"}', 80, 30, 40, 'hop_side', side=sd, curve=(2.6, 24, 44), dirDeg=90 * sd,
               tracks=[track(f'selvark_hop_kick_{"l" if sd > 0 else "r"}', 0.6, 2.2, [(30, [0.5 * sd, 0.8, 1.2], [0.2 * sd, -0.1, -1]), (40, [1.5 * sd, 0.7, 1.2], [0.2 * sd, -0.1, -1])])],
               hits=[hit('kick', 30, 40, f'selvark_hop_kick_{"l" if sd > 0 else "r"}', 20, 'knockdown', cost=25)],
               sounds=[(4, 'galdros_warn'), (28, 'galdros_swing')], ai=ai(0, 5.5, 140, 2.5, minA=35, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('gust', 110, 52, 62, 'gust', turn=(30, 90),
             tracks=[track('selvark_gust', 1.5, 6.8, [(52, [0, 2.0, 1.4], [0, -0.17, 1]), (62, [0, 1.9, 1.4], [0, -0.2, 1])])],
             hits=[hit('wind', 52, 62, 'selvark_gust', 12, 'knockdown', cost=30)],
             sounds=[(4, 'beast_cry'), (50, 'gust')], vfx=[(52, 'gust')], ai=ai(3, 11, 35, 2, cd=360)),
        move('lunge', 90, 34, 44, 'lunge', curve=(2.8, 28, 44), turn=(24, 80),
             tracks=[track('selvark_lunge', 0.55, 1.6, [(34, [0, 1.7, 1.3], [0, -0.25, 1]), (44, [0, 1.5, 1.4], [0, -0.3, 1])])],
             hits=[hit('horn', 34, 44, 'selvark_lunge', 22, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'galdros_warn'), (32, 'galdros_swing')], ai=ai(3, 8, 30, 2.5)),
        move('back_flip', 100, 28, 38, 'hop_back', curve=(-4.0, 26, 54),
             tracks=[track('selvark_back_flip', 0.7, 1.6, [(28, [0, 0.9, 1.2], [0, 0.4, 1]), (38, [0, 1.4, 1.0], [0, 1, 0.3])])],
             hits=[hit('fore', 28, 38, 'selvark_back_flip', 18, 'flinch', cost=25)],
             sounds=[(26, 'gust')], ai=ai(0, 3.6, 70, 2, cd=420)),
    ],
    mats=[('sail_membrane', '帆膜', 25), ('elastic_tendon', '弾性腱', 30), ('sail_cartilage', '帆角軟骨', 40), ('flow_concha', '整流鼻甲', 55)],
    breaks={'crest_l': [0, 2], 'crest_r': [0, 2], 'hindleg': [1], 'tail': [1, 3]},
    quest=('帆角の風', '風礫盆地の草の段丘に、帆角獣セルヴァルクが出た。角膜を大きく開く威嚇と、横跳びの蹴りに気をつけて狩る。'),
    route=dict(start='a2', roam=['a2', 'a4', 'a3'], nest='a10'),
))

# ---- 03 泥冠獣 ヌメラドン（四足重獣。水）----
S = Sp('numeradon', 0.00414, (700, 880))
SPECIES.append(dict(
    sp=S, no=3, name='泥冠獣 ヌメラドン', frame='quad', rig='quadruped_heavy',
    plan=dict(
        spine=[[30, 705, 6, 6, 10], [180, 650, 40, 45, 80], [330, 535, 205, 195, 230], [520, 478, 268, 268, 300], [750, 465, 285, 290, 320],
               [980, 450, 280, 270, 300], [1150, 430, 190, 170, 220], [1300, 430, 140, 130, 160], [1440, 430, 80, 80, 100], [1500, 425, 30, 40, 50]],
        roles='-tbbbbnh--', root=4,
        legs=[
            dict(group='F', attach=5, pts=[[1000, 520, 0.75], [1004, 700, 1.0], [1008, 780, 1.05], [1010, 855, 1.08]], r=[125, 110, 100, 95], mirror=True, phase=0.0, foot=[230, 55]),
            dict(group='H', attach=3, pts=[[380, 520, 0.75], [380, 700, 1.0], [383, 780, 1.05], [385, 850, 1.08]], r=[130, 115, 105, 100], mirror=True, phase=0.5, foot=[230, 55]),
        ],
        extras=[
            dict(kind='blob', bone='own:dish', own=dict(name='dish', at=[1150, 280], parent='spine:7'), c=[1190, 255], r=[310, 32, 1.05], pitch=0.06, ch='dish', part='dish'),
            dict(kind='blob', bone='spine:7', c=[1250, 440], r=[70, 60, 0.28], mirror=True, x=0.62, part='sacs'),
            dict(kind='blob', bone='spine:7', c=[1330, 360], r=[16, 12, 0.04], mirror=True, x=0.52, shade=0.2),
        ],
        stride=1.4, lift=0.18,
    ),
    stats=dict(hp=2000, bodyRadius=1.5, turn=50, moveSpeed=2.0, approach=(4.5, 50), collision=[(0.0, 1.45), (1.6, 1.0), (-1.5, 1.1), (2.7, 0.6)],
               discover=(15, 120, 6), rage=(500, 2100, 1.25, 1.2, 0.6), cooldown=(55, 110)),
    parts=lambda s: [
        part('head', '頭', 'hide', (0.7, 0.75, 0.6), [(s.m(1250, 440), s.m(1490, 430), 0.5)], flinch=(170, 60, 50, False)),
        part('dish', '頭頂の泥皿', 'rock', (0.55, 0.7, 0.5), [(s.m(950, 240, 0.0), s.m(1450, 270, 0.0), 0.45)], broken=(0.7, 0.85, 0.65), dur=240),
        part('sacs', '左右の水圧嚢', 'hide', (0.8, 0.7, 0.75), [(s.m(1180, 440, 0.62), s.m(1320, 440, 0.62), 0.32), (s.m(1180, 440, -0.62), s.m(1320, 440, -0.62), 0.32)], broken=(0.9, 0.8, 0.85), dur=200),
        part('foreclaw', '前脚の泥掻き爪', 'shell', (0.5, 0.55, 0.45), [(s.m(1000, 660, 1.05), s.m(1010, 850, 1.05), 0.42), (s.m(1000, 660, -1.05), s.m(1010, 850, -1.05), 0.42)], broken=(0.6, 0.65, 0.55), dur=230, flinch=(240, 80, 130, True)),
        part('tail', '尾の泥ひれ', 'hide', (0.6, 0.55, 0.55), [(s.m(330, 560), s.m(60, 700), 0.3)], broken=(0.7, 0.65, 0.65), dur=170),
        part('body', '胴', 'hide', (0.45, 0.5, 0.4), [(s.m(400, 500), s.m(1050, 450), 1.05)]),
        part('hindleg', '後脚', 'hide', (0.45, 0.5, 0.4), [(s.m(380, 660, 1.05), s.m(385, 840, 1.05), 0.44), (s.m(380, 660, -1.05), s.m(385, 840, -1.05), 0.44)], flinch=(240, 80, 130, True)),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'galdros_roar')]),
        move('mud_ball', 100, 46, 52, 'spit', turn=(40, 60),
             hazards=[hazard(48, 3, 2.4, 1.6, 42, 8, 18, 'flinch', s.m(1450, 250), 'mud', peak=4)],
             sounds=[(4, 'galdros_warn'), (46, 'splash')], ai=ai(6, 18, 45, 2.5, cd=300)),
        move('belly_slide', 110, 40, 66, 'slide', curve=(7.0, 40, 66),
             tracks=[track('numeradon_belly_slide', 1.3, 1.6, [(40, [0, 0.9, 1.6], [0, 0, 1]), (66, [0, 0.9, 1.6], [0, 0, 1])])],
             hits=[hit('belly', 40, 66, 'numeradon_belly_slide', 26, 'knockdown', cost=40)],
             sounds=[(4, 'galdros_warn'), (40, 'galdros_charge')], ai=ai(5, 14, 25, 2, cd=420, clear=8)),
        *[move(f'push_{"l" if sd > 0 else "r"}', 90, 36, 46, 'shoulder', side=sd, curve=(1.6, 34, 48), dirDeg=90 * sd,
               tracks=[track(f'numeradon_push_{"l" if sd > 0 else "r"}', 1.0, 3.2, [(36, [1.4 * sd, 1.1, 1.6], [0, 0, -1]), (46, [1.7 * sd, 1.0, 1.6], [0, 0, -1])])],
               hits=[hit('shoulder', 36, 46, f'numeradon_push_{"l" if sd > 0 else "r"}', 22, 'knockdown', cost=35)],
               sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 5, 135, 2.5, minA=40, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('splash', 80, 30, 40, 'paw',
             tracks=[track('numeradon_splash', 1.1, 3.6, [(30, [-1.8, 0.4, 3.0], [1, 0, 0]), (40, [-1.8, 0.4, 3.2], [1, 0, 0])])],
             hits=[hit('splash', 30, 40, 'numeradon_splash', 14, 'flinch', cost=20)],
             sounds=[(28, 'splash')], vfx=[(32, 'mud_splash')], ai=ai(0, 4.6, 60, 3)),
    ],
    mats=[('mud_crystal', '泥晶', 30), ('waterproof_hide', '耐水皮', 25), ('mud_crown', '泥冠片', 40), ('pressure_sac', '水圧嚢膜', 55)],
    breaks={'dish': [2, 0], 'sacs': [3], 'foreclaw': [1, 0], 'tail': [1]},
    quest=('泥皿の主', '根絡み湿原から、泥冠獣ヌメラドンが風礫盆地の水場へ下りてきた。頭の泥皿から飛ぶ泥玉と、腹滑りに注意。'),
    route=dict(start='a4', roam=['a4', 'a7', 'a3'], nest='a10'),
))

# ---- 04 鐘嚢獣 ボルナケル（四足重獣。気絶）----
S = Sp('bornakel', 0.0040, (650, 950))
SPECIES.append(dict(
    sp=S, no=4, name='鐘嚢獣 ボルナケル', frame='quad', rig='quadruped_heavy',
    plan=dict(
        spine=[[35, 605, 8, 8, 10], [150, 570, 50, 50, 60], [300, 500, 200, 200, 220], [500, 490, 215, 225, 240], [750, 500, 200, 215, 240],
               [980, 470, 170, 210, 220], [1150, 390, 140, 150, 160], [1280, 340, 110, 110, 120], [1370, 380, 95, 95, 100]],
        roles='-tbbbbnh-', root=4,
        legs=[
            dict(group='F', attach=5, pts=[[970, 520, 0.6], [972, 700, 0.85], [975, 820, 0.9], [975, 925, 0.92]], r=[125, 112, 105, 100], mirror=True, phase=0.0, foot=[250, 55]),
            dict(group='H', attach=3, pts=[[320, 520, 0.6], [315, 700, 0.85], [312, 810, 0.9], [320, 920, 0.92]], r=[125, 110, 100, 95], mirror=True, phase=0.5, foot=[240, 55]),
        ],
        extras=[
            dict(kind='funnel', bone='spine:7', a=[1360, 385], b=[1478, 395], ra=100, rb=150, part='head'),
            dict(kind='blob', bone='own:sac_l', own=dict(name='sac_l', at=[680, 250], parent='spine:4'), c=[680, 205], r=[140, 140, 0.56], x=0.35, ch='sac', part='sac_l'),
            dict(kind='blob', bone='own:sac_r', own=dict(name='sac_r', at=[950, 300], parent='spine:5'), c=[950, 255], r=[165, 160, 0.64], x=-0.35, ch='sac', part='sac_r'),
            dict(kind='blob', bone='own:sac_c', own=dict(name='sac_c', at=[1130, 580], parent='spine:6'), c=[1150, 610], r=[140, 140, 0.56], ch='sac', part='sac_chest'),
            dict(kind='blob', bone='spine:7', c=[1300, 265], r=[14, 12, 0.04], mirror=True, x=0.44, shade=0.2),
        ],
        stride=1.5, lift=0.2,
    ),
    stats=dict(hp=2000, bodyRadius=1.4, turn=55, moveSpeed=2.2, approach=(4.2, 50), collision=[(0.2, 1.3), (1.6, 1.0), (-1.4, 1.0)],
               discover=(15, 120, 6), rage=(500, 2100, 1.25, 1.2, 0.6), cooldown=(55, 105)),
    parts=lambda s: [
        part('head', '頭鐘', 'rock', (0.6, 0.7, 0.55), [(s.m(1230, 340), s.m(1470, 395), 0.55)], broken=(0.7, 0.8, 0.65), dur=230, flinch=(170, 60, 50, False)),
        part('sac_chest', '胸の共鳴嚢', 'hide', (0.85, 0.8, 0.8), [(s.m(1150, 610), None, 0.55)], broken=(0.95, 0.9, 0.9), dur=190),
        part('sac_l', '左肩の共鳴嚢', 'hide', (0.85, 0.8, 0.8), [(s.m(680, 205, 0.35), None, 0.55)], broken=(0.95, 0.9, 0.9), dur=190),
        part('sac_r', '右肩の共鳴嚢', 'hide', (0.85, 0.8, 0.8), [(s.m(950, 255, -0.35), None, 0.62)], broken=(0.95, 0.9, 0.9), dur=190),
        part('body', '胴', 'hide', (0.45, 0.5, 0.4), [(s.m(350, 495), s.m(1050, 470), 0.85)]),
        part('foreleg', '前脚', 'hide', (0.45, 0.5, 0.4), [(s.m(970, 640, 0.9), s.m(975, 900, 0.9), 0.44), (s.m(970, 640, -0.9), s.m(975, 900, -0.9), 0.44)], flinch=(230, 80, 130, True)),
        part('hindleg', '後脚', 'hide', (0.45, 0.5, 0.4), [(s.m(320, 640, 0.9), s.m(320, 900, 0.9), 0.42), (s.m(320, 640, -0.9), s.m(320, 900, -0.9), 0.42)], flinch=(230, 80, 130, True)),
        part('tail', '尾', 'hide', (0.55, 0.5, 0.5), [(s.m(280, 520), s.m(60, 600), 0.22)]),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'bell_boom')]),
        move('sound_blast', 120, 56, 70, 'blast', turn=(36, 60),
             tracks=[track('bornakel_sound_blast', 1.6, 6.6, [(56, [0, 2.1, 3.0], [0, -0.22, 1]), (70, [0, 2.0, 3.0], [0, -0.25, 1])])],
             hits=[hit('sound', 56, 70, 'bornakel_sound_blast', 10, 'flinch', cost=30, status=('stun', 55))],
             sounds=[(4, 'galdros_warn'), (54, 'bell_boom')], vfx=[(56, 'sound_wave')], ai=ai(3, 11, 35, 2.5, cd=300)),
        move('sac_slam', 100, 38, 50, 'shoulder', side=-1, curve=(3.0, 34, 52),
             tracks=[track('bornakel_sac_slam', 1.1, 2.0, [(38, [-0.9, 1.6, 1.4], [1, 0, 0.3]), (50, [-0.9, 1.5, 1.6], [1, 0, 0.35])])],
             hits=[hit('sac', 38, 50, 'bornakel_sac_slam', 26, 'knockdown', cost=40)],
             sounds=[(4, 'galdros_warn'), (36, 'galdros_charge')], ai=ai(0, 7, 50, 2.5)),
        move('bell_slam', 110, 48, 56, 'slam_head', turn=(30, 50), slamTrack='bornakel_bell_slam',
             tracks=[track('bornakel_bell_slam', 0.9, 2.6, [(0, [0, 2.6, 2.2], [0, 0.6, 0.8]), (48, [0, 2.6, 2.2], [0, 0.6, 0.8]), (52, [0, 2.4, 2.4], [0, -0.75, 0.66]), (56, [0, 2.4, 2.4], [0, -0.8, 0.6])])],
             hits=[hit('bell', 48, 56, 'bornakel_bell_slam', 28, 'knockdown', cost=40, status=('stun', 35))],
             sounds=[(4, 'bell_boom'), (46, 'galdros_swing')], vfx=[(54, 'ground_slam')], ai=ai(0, 5, 35, 2.5)),
        move('shiver_step', 90, 36, 46, 'shiver', curve=(2.2, 34, 46),
             tracks=[track('bornakel_shiver_step', 1.1, 1.2, [(36, [0, 1.4, 2.0], [0, 0, 1]), (46, [0, 1.4, 2.1], [0, 0, 1])])],
             hits=[hit('chest', 36, 46, 'bornakel_shiver_step', 18, 'flinch', cost=25, status=('stun', 20))],
             sounds=[(6, 'bell_boom'), (34, 'galdros_swing')], ai=ai(2, 6, 40, 2)),
    ],
    mats=[('echo_sac', '響嚢', 40), ('hard_hide', '硬皮', 25), ('bell_skull', '鐘頭骨', 45), ('resonance_valve', '共鳴弁', 55)],
    breaks={'head': [2], 'sac_chest': [0, 3], 'sac_l': [0, 3], 'sac_r': [0, 3]},
    quest=('鐘の鳴る谷', '灰鐘鉱山から、鐘嚢獣ボルナケルが風礫盆地へ迷い出た。三つの嚢をふくらませた後の音圧を浴びると、気が遠くなる。'),
    route=dict(start='a7', roam=['a7', 'a4', 'a2'], nest='a10'),
))

# ---- 05 灰帷鳥 アシュレイア（二足翼獣。睡眠）----
S = Sp('ashreia', 0.00363, (900, 990))
SPECIES.append(dict(
    sp=S, no=5, name='灰帷鳥 アシュレイア', frame='biped', rig='biped_wing',
    plan=dict(
        spine=[[90, 740, 8, 8, 12], [250, 650, 30, 30, 40], [450, 560, 55, 60, 70], [650, 470, 120, 130, 130], [880, 470, 210, 220, 190], [1060, 400, 130, 150, 140],
               [1090, 260, 60, 60, 60], [1070, 170, 48, 48, 48], [1110, 100, 45, 45, 45], [1160, 85, 45, 40, 42], [1220, 120, 18, 18, 18], [1290, 165, 4, 4, 4]],
        roles='-tttbbnnh---', root=4,
        legs=[dict(group='B', attach=4, pts=[[860, 620, 0.3], [805, 775, 0.3], [865, 935, 0.3], [905, 975, 0.3]], r=[72, 30, 18, 14], mirror=True, phase=0.0, foot=[140, 18])],
        extras=[
            dict(kind='sheet', bone='own:wing', own=dict(name='wing', at=[950, 330], parent='spine:5'), mirror=True, x=0.66, tilt=0.12, thick=0.04, ch='wing',
                 pts=[[950, 330], [650, 330], [520, 470], [500, 560], [620, 650], [720, 690], [900, 620], [960, 450]]),
            dict(kind='sheet', bone='chain', x=0.0, thick=0.05, pts=[[650, 380], [400, 470], [150, 590], [60, 760], [140, 800], [330, 720], [520, 640], [660, 560]], part='tail'),
            dict(kind='sheet', bone='spine:8', x=0.0, thick=0.04, pts=[[1090, 60], [1010, 40], [990, 120], [1060, 150], [1110, 110]], part='crest'),
            dict(kind='blob', bone='spine:4', c=[880, 520], r=[75, 65, 0.22], mirror=True, x=0.56, part='tuft'),
            dict(kind='blob', bone='spine:8', c=[1170, 70], r=[10, 9, 0.03], mirror=True, x=0.13, shade=0.25),
        ],
        stride=1.6, lift=0.3,
    ),
    stats=dict(hp=1450, bodyRadius=0.8, turn=100, moveSpeed=3.0, approach=(3.8, 50), collision=[(0.0, 0.8), (-1.0, 0.6)],
               discover=(16, 140, 6), rage=(400, 1800, 1.3, 1.15, 0.6), cooldown=(45, 95)),
    parts=lambda s: [
        part('crest', '頭の冠羽', 'hide', (0.8, 0.7, 0.75), [(s.m(1050, 110), s.m(1290, 160), 0.3)], broken=(0.9, 0.8, 0.85), dur=150, flinch=(120, 50, 45, False)),
        part('tuft_l', '左の灰粉房', 'hide', (0.75, 0.7, 0.7), [(s.m(800, 520, 0.56), s.m(960, 520, 0.56), 0.28)], broken=(0.85, 0.8, 0.8), dur=170),
        part('tuft_r', '右の灰粉房', 'hide', (0.75, 0.7, 0.7), [(s.m(800, 520, -0.56), s.m(960, 520, -0.56), 0.28)], broken=(0.85, 0.8, 0.8), dur=170),
        part('tail', '尾羽', 'hide', (0.6, 0.5, 0.6), [(s.m(620, 480), s.m(150, 680), 0.28)], broken=(0.7, 0.6, 0.7), dur=160),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(680, 470), s.m(1060, 420), 0.7), (s.m(1080, 330), s.m(1100, 140), 0.2)]),
        part('legs', '脚', 'shell', (0.45, 0.5, 0.4), [(s.m(840, 640, 0.3), s.m(860, 930, 0.3), 0.15), (s.m(840, 640, -0.3), s.m(860, 930, -0.3), 0.15)], flinch=(190, 70, 120, True)),
    ],
    moves=lambda s: [
        move('roar', 90, 90, 90, 'roar', sounds=[(8, 'bird_screech')]),
        move('ash_curtain', 120, 54, 74, 'curtain', turn=(36, 70),
             tracks=[track('ashreia_ash_curtain', 1.3, 5.2, [(54, [-2.6, 1.2, 3.0], [1, 0, 0]), (74, [-2.6, 1.1, 3.4], [1, 0, 0])])],
             hits=[hit('ash', 54, 74, 'ashreia_ash_curtain', 6, 'flinch', cost=15, status=('sleep', 100))],
             sounds=[(4, 'bird_screech'), (52, 'gust')], vfx=[(54, 'ash_cloud')], ai=ai(2, 8, 40, 2.5, cd=360)),
        move('beak_thrust', 80, 32, 40, 'thrust_head', curve=(1.0, 28, 40), turn=(22, 90),
             tracks=[track('ashreia_beak_thrust', 0.45, 2.4, [(32, [0, 1.3, 0.8], [0, -0.28, 1]), (40, [0, 1.1, 1.0], [0, -0.3, 1])])],
             hits=[hit('beak', 32, 40, 'ashreia_beak_thrust', 20, 'flinch', kind='cut', cost=25)],
             sounds=[(30, 'galdros_swing')], ai=ai(0, 4.8, 30, 3)),
        move('glide', 110, 40, 68, 'glide', curve=(8.0, 40, 68),
             tracks=[track('ashreia_glide', 1.0, 1.2, [(40, [0, 1.4, 0.6], [0, 0, 1]), (68, [0, 1.3, 0.6], [0, 0, 1])])],
             hits=[hit('body', 40, 68, 'ashreia_glide', 22, 'knockdown', cost=35)],
             sounds=[(4, 'bird_screech'), (40, 'gust')], ai=ai(6, 15, 25, 2, cd=420, clear=9)),
        *[move(f'wing_sweep_{"l" if sd > 0 else "r"}', 90, 34, 44, 'wing_sweep', side=sd,
               tracks=[track(f'ashreia_wing_sweep_{"l" if sd > 0 else "r"}', 0.7, 3.0, [(34, [0.6 * sd, 1.5, -0.4], [0.5 * sd, 0, -1]), (39, [0.6 * sd, 1.4, -0.2], [1 * sd, -0.1, 0]), (44, [0.6 * sd, 1.4, 0.0], [0.9 * sd, -0.1, 0.7])])],
               hits=[hit('wing', 34, 44, f'ashreia_wing_sweep_{"l" if sd > 0 else "r"}', 14, 'flinch', cost=20, status=('sleep', 40))],
               sounds=[(32, 'gust')], ai=ai(0, 5, 150, 2.5, minA=40, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
    ],
    mats=[('ash_feather', '灰羽', 25), ('veil_membrane', '帷膜', 30), ('sleep_powder', '眠灰粉', 45), ('powder_sac', '灰粉房膜', 55)],
    breaks={'crest': [0, 2], 'tuft_l': [2, 3], 'tuft_r': [2, 3], 'tail': [0, 1]},
    quest=('灰の帷', '灰帷鳥アシュレイアが、風礫盆地の岩陰に居着いた。帷羽を持ち上げたら、眠りの灰が来る。'),
    route=dict(start='a6', roam=['a6', 'a9', 'a3'], nest='a10'),
))

# ---- 06 燐尾鳥 ルミスカ（二足翼獣。雷）----
S = Sp('lumisca', 0.0035, (1100, 935))
NODES = [(190, 508, 18), (255, 520, 20), (320, 522, 21), (390, 515, 22), (460, 500, 24), (530, 470, 26), (610, 430, 28), (690, 365, 30), (765, 310, 30), (870, 262, 30), (960, 250, 28), (1060, 272, 26)]
SPECIES.append(dict(
    sp=S, no=6, name='燐尾鳥 ルミスカ', frame='biped', rig='biped_wing',
    plan=dict(
        spine=[[20, 590, 4, 4, 5], [100, 545, 20, 22, 22], [250, 525, 40, 45, 42], [450, 485, 55, 60, 56], [650, 430, 75, 80, 72], [850, 390, 120, 120, 110],
               [1100, 410, 175, 170, 150], [1330, 360, 120, 140, 120], [1380, 230, 55, 60, 55], [1420, 170, 55, 50, 48], [1465, 215, 22, 22, 22], [1480, 260, 5, 5, 5]],
        roles='-ttttbbbnh--', root=6,
        legs=[dict(group='B', attach=6, pts=[[1110, 560, 0.3], [1070, 730, 0.3], [1160, 900, 0.3], [1220, 925, 0.3]], r=[72, 32, 20, 14], mirror=True, phase=0.0, foot=[150, 18])],
        extras=[
            dict(kind='sheet', bone='own:wing', own=dict(name='wing', at=[1250, 330], parent='spine:7'), mirror=True, x=0.52, tilt=0.1, thick=0.04, ch='wing', part='wing',
                 pts=[[1240, 300], [1000, 320], [790, 540], [1000, 470], [1230, 420]]),
            dict(kind='sheet', bone='spine:9', x=0.0, thick=0.04, pts=[[1440, 110], [1250, 100], [1330, 70], [1420, 60], [1470, 120]], part='head'),
            *[dict(kind='blob', bone='chain', c=[x, y], r=[r * 1.25, r * 0.85, r * 0.0042], glow=True, part='nodes') for x, y, r in NODES],
            dict(kind='blob', bone='spine:9', c=[1440, 160], r=[10, 9, 0.03], mirror=True, x=0.13, shade=0.25),
        ],
        stride=1.8, lift=0.3, glowColor=[0.9, 1.0, 0.35],
    ),
    stats=dict(hp=1550, bodyRadius=0.8, turn=105, moveSpeed=3.4, approach=(3.8, 50), collision=[(0.0, 0.75), (-1.4, 0.55), (-2.6, 0.45)],
               discover=(17, 140, 6), rage=(400, 1800, 1.3, 1.15, 0.6), cooldown=(45, 90)),
    parts=lambda s: [
        part('head', '頭の額板', 'shell', (0.75, 0.75, 0.65), [(s.m(1400, 180), s.m(1480, 250), 0.28)], broken=(0.85, 0.85, 0.75), dur=150, flinch=(130, 50, 45, False)),
        part('wing', '左翼の縁', 'hide', (0.7, 0.6, 0.7), [(s.m(1200, 330, 0.55), s.m(850, 500, 0.6), 0.3)], broken=(0.8, 0.7, 0.8), dur=160),
        part('nodes', '尾の燐節', 'shell', (0.7, 0.65, 0.75), [(s.m(1000, 270), s.m(500, 470), 0.3)], broken=(0.8, 0.75, 0.85), dur=200),
        part('tail_tip', '尾先の放電板', 'shell', (0.65, 0.6, 0.7), [(s.m(420, 495), s.m(40, 580), 0.2)], broken=(0.75, 0.7, 0.8), dur=150),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(900, 400), s.m(1330, 380), 0.58), (s.m(1360, 300), s.m(1400, 200), 0.2)]),
        part('legs', '脚', 'shell', (0.45, 0.5, 0.4), [(s.m(1100, 580, 0.3), s.m(1150, 890, 0.3), 0.15), (s.m(1100, 580, -0.3), s.m(1150, 890, -0.3), 0.15)], flinch=(190, 70, 120, True)),
    ],
    moves=lambda s: [
        move('roar', 90, 90, 90, 'roar', sounds=[(8, 'bird_screech'), (40, 'zap')]),
        move('discharge', 120, 60, 64, 'spark_tail', turn=(40, 70),
             hazards=[hazard(60, 6, 0.3, 1.1, 30, 10, 18, 'flinch', [0, 0.2, 1.2], 'spark', peak=0, pattern='line')],
             sounds=[(6, 'zap'), (58, 'zap')], ai=ai(4, 16, 45, 2.5, cd=360)),
        move('kick', 80, 30, 38, 'kick_front', side=1, curve=(0.8, 26, 38), turn=(20, 90),
             tracks=[track('lumisca_kick', 0.5, 2.2, [(30, [0.3, 1.5, 0.4], [0, -0.1, 1]), (38, [0.3, 1.3, 0.5], [0, -0.15, 1])])],
             hits=[hit('kick', 30, 38, 'lumisca_kick', 22, 'knockdown', cost=30)],
             sounds=[(28, 'galdros_swing')], ai=ai(0, 4.5, 35, 3)),
        *[move(f'tail_sweep_{"l" if sd > 0 else "r"}', 100, 40, 54, 'sweep_tail', side=sd,
               tracks=[track(f'lumisca_tail_sweep_{"l" if sd > 0 else "r"}', 0.5, 3.0, [(40, [0, 1.1, -0.8], [1 * sd, -0.1, -0.2]), (47, [0, 1.1, -0.8], [0, -0.1, -1]), (54, [0, 1.1, -0.8], [-1 * sd, -0.1, -0.2])])],
               hits=[hit('tail', 40, 54, f'lumisca_tail_sweep_{"l" if sd > 0 else "r"}', 22, 'knockdown', cost=30)],
               sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 4.8, 180, 2.5, minA=60, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('leap_in', 100, 44, 52, 'leap', curve=(5.5, 34, 50), slamTrack='lumisca_leap_in',
             tracks=[track('lumisca_leap_in', 1.4, 1.2, [(44, [0, 0.7, 0.6], [0, 0, 1]), (52, [0, 0.6, 0.6], [0, 0, 1])])],
             hits=[hit('land', 44, 52, 'lumisca_leap_in', 24, 'knockdown', cost=35)],
             sounds=[(4, 'bird_screech'), (34, 'gust')], vfx=[(50, 'ground_slam')], ai=ai(4, 11, 30, 2, cd=300, clear=6)),
    ],
    mats=[('phos_node', '燐節', 35), ('light_hide', '光皮', 25), ('storage_film', '蓄電薄膜', 45), ('discharge_plate', '放電尾板', 55)],
    breaks={'head': [1, 0], 'wing': [2], 'nodes': [0, 2], 'tail_tip': [3]},
    quest=('燐尾の光', '硝砂海岸の燐尾鳥ルミスカが、風礫盆地へ渡ってきた。尾の節が順に光ったら、地面を雷が走る。'),
    route=dict(start='a9', roam=['a9', 'a6', 'a3'], nest='a10'),
))

# ---- 07 硝殻蟹 オルグラス（六脚甲殻）----
S = Sp('orglass', 0.00367, (700, 965))
SPECIES.append(dict(
    sp=S, no=7, name='硝殻蟹 オルグラス', frame='crab', rig='crust_six',
    plan=dict(
        spine=[[60, 520, 60, 60, 70], [250, 500, 140, 130, 260], [500, 500, 170, 150, 300], [750, 510, 160, 140, 280], [950, 470, 120, 110, 220], [1060, 400, 70, 70, 120], [1120, 400, 30, 30, 50]],
        roles='-bbbbh-', root=3,
        legs=[
            dict(group='M1', attach=4, pts=[[760, 580, 0.75], [750, 690, 1.25], [800, 850, 1.55], [840, 960, 1.65]], r=[48, 42, 34, 16], mirror=True, phase=0.0, swing='y'),
            dict(group='M2', attach=3, pts=[[560, 580, 0.8], [470, 630, 1.35], [400, 800, 1.65], [415, 955, 1.75]], r=[48, 42, 34, 16], mirror=True, phase=0.5, swing='y'),
            dict(group='M3', attach=2, pts=[[330, 570, 0.75], [180, 630, 1.25], [95, 800, 1.5], [80, 920, 1.6]], r=[45, 40, 32, 15], mirror=True, phase=0.0, swing='y'),
            dict(group='clawR', attach=4, pts=[[850, 560, -0.7], [1000, 610, -1.05], [1080, 640, -1.15]], r=[70, 75, 80], mirror=False, phase=0.0),
            dict(group='clawL', attach=5, pts=[[1000, 430, 0.5], [1150, 400, 0.7], [1250, 380, 0.75]], r=[35, 32, 30], mirror=False, phase=0.0),
        ],
        extras=[
            dict(kind='blob', bone='own:plates', own=dict(name='plates', at=[560, 470], parent='spine:2'), c=[560, 330], r=[520, 210, 0.95], ch='plates', part='plates'),
            dict(kind='sheet', bone='own:plates', x=0.0, thick=0.08, part='plates', pts=[[470, 300], [500, 60], [600, 55], [980, 300], [900, 340]]),
            dict(kind='sheet', bone='own:plates', x=0.0, thick=0.08, part='plates', pts=[[230, 330], [240, 180], [560, 230], [450, 330]]),
            dict(kind='sheet', bone='own:plates', x=0.0, thick=0.08, part='plates', pts=[[30, 540], [90, 360], [230, 300], [260, 420]]),
            # 右の大鋏: 手のひら・動く指（own:finger_R）・動かない指
            dict(kind='blob', bone='leg:clawR:2', c=[1110, 650], r=[230, 175, 0.5], x=-1.15, part='claw_r'),
            dict(kind='cone', bone='own:finger_R', own=dict(name='finger_R', at=[1250, 580], parent='leg:clawR:2'), a=[1250, 590], b=[1500, 680], ra=75, rb=8, x=-1.15, ch='finger', part='claw_r'),
            dict(kind='cone', bone='leg:clawR:2', a=[1230, 760], b=[1480, 745], ra=62, rb=8, x=-1.15, part='claw_r'),
            # 左の小鋏
            dict(kind='blob', bone='leg:clawL:2', c=[1320, 345], r=[85, 65, 0.2], x=0.75, part='claw_l'),
            dict(kind='cone', bone='own:finger_L', own=dict(name='finger_L', at=[1360, 320], parent='leg:clawL:2'), a=[1360, 320], b=[1470, 295], ra=30, rb=5, x=0.75, ch='finger'),
            # 眼柄
            dict(kind='cone', bone='spine:5', a=[1080, 350], b=[1110, 290], ra=11, rb=9, mirror=True, x=0.13),
            dict(kind='blob', bone='spine:5', c=[1112, 288], r=[16, 16, 0.06], mirror=True, x=0.13, shade=0.2),
        ],
        stride=1.3, lift=0.25,
    ),
    stats=dict(hp=1900, bodyRadius=1.4, turn=70, moveSpeed=2.4, approach=(4.0, 50), collision=[(0.0, 1.5), (1.4, 1.0)],
               discover=(14, 120, 6), rage=(480, 2100, 1.25, 1.2, 0.6), cooldown=(50, 100)),
    parts=lambda s: [
        part('claw_r', '右大鋏', 'shell', (0.45, 0.55, 0.4), [(s.m(950, 650, -1.15), s.m(1450, 680, -1.15), 0.6)], broken=(0.6, 0.7, 0.55), dur=260, flinch=(200, 70, 60, False)),
        part('claw_l', '左小鋏', 'shell', (0.6, 0.65, 0.55), [(s.m(1150, 400, 0.7), s.m(1420, 320, 0.75), 0.3)], broken=(0.7, 0.75, 0.65), dur=160),
        part('plates', '背の硝殻板', 'shell', (0.35, 0.45, 0.35), [(s.m(200, 360), s.m(950, 300), 0.7)], broken=(0.55, 0.65, 0.5), dur=300),
        part('greave', '前脚の甲', 'shell', (0.5, 0.55, 0.45), [(s.m(760, 600, 1.25), s.m(840, 940, 1.6), 0.22), (s.m(760, 600, -1.25), s.m(840, 940, -1.6), 0.22)], broken=(0.6, 0.65, 0.55), dur=200, flinch=(220, 80, 130, True)),
        part('head', '頭', 'hide', (0.75, 0.7, 0.7), [(s.m(1000, 410), s.m(1110, 400), 0.32)], flinch=(140, 50, 45, False)),
        part('body', '胴', 'hide', (0.55, 0.55, 0.5), [(s.m(250, 520), s.m(950, 480), 0.65)]),
        part('legs', '脚', 'shell', (0.45, 0.5, 0.4), [(s.m(560, 600, 1.35), s.m(410, 940, 1.7), 0.2), (s.m(560, 600, -1.35), s.m(410, 940, -1.7), 0.2), (s.m(330, 600, 1.25), s.m(90, 900, 1.55), 0.2), (s.m(330, 600, -1.25), s.m(90, 900, -1.55), 0.2)], flinch=(240, 80, 130, True)),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'shell_clack'), (40, 'shell_clack')]),
        move('pinch', 90, 38, 46, 'claw_pinch', curve=(0.8, 34, 46), turn=(30, 60),
             tracks=[track('orglass_pinch', 0.75, 2.4, [(38, [-1.0, 1.2, 1.4], [0.25, -0.05, 1]), (46, [-0.9, 1.1, 1.6], [0.3, -0.08, 1])])],
             hits=[hit('claw', 38, 46, 'orglass_pinch', 28, 'knockdown', kind='cut', cost=40)],
             sounds=[(4, 'shell_clack'), (36, 'galdros_swing'), (44, 'shell_clack')], ai=ai(0, 5, 40, 3)),
        *[move(f'dash_{"l" if sd > 0 else "r"}', 90, 30, 52, 'dash_side', side=sd, curve=(5.0, 30, 52), dirDeg=90 * sd,
               tracks=[track(f'orglass_dash_{"l" if sd > 0 else "r"}', 1.2, 3.0, [(30, [1.3 * sd, 1.2, -1.5], [0, 0, 1]), (52, [1.3 * sd, 1.2, -1.5], [0, 0, 1])])],
               hits=[hit('body', 30, 52, f'orglass_dash_{"l" if sd > 0 else "r"}', 24, 'knockdown', cost=35)],
               sounds=[(4, 'shell_clack'), (30, 'galdros_charge')], ai=ai(2, 9, 135, 2.5, minA=45, side='left' if sd > 0 else 'right', cd=240)) for sd in (1, -1)],
        move('fan_pinch', 100, 44, 54, 'claw_fan', turn=(30, 60),
             tracks=[track('orglass_fan_pinch', 0.7, 2.4, [(44, [0, 1.3, 1.6], [-1, 0, 0.5]), (49, [0, 1.3, 1.6], [0, 0, 1]), (54, [0, 1.3, 1.6], [1, 0, 0.5])])],
             hits=[hit('claws', 44, 54, 'orglass_fan_pinch', 20, 'flinch', kind='cut', cost=30)],
             sounds=[(4, 'shell_clack'), (42, 'galdros_swing'), (52, 'shell_clack')], ai=ai(0, 5, 60, 2.5)),
        move('shell_swing', 100, 40, 56, 'shell_swing',
             tracks=[track('orglass_shell_swing', 2.2, 3.2, [(40, [0, 1.6, -1.6], [0, 0, 1]), (56, [0, 1.6, -1.6], [0, 0, 1])])],
             hits=[hit('shell', 40, 56, 'orglass_shell_swing', 16, 'flinch', cost=25)],
             sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 3.6, 180, 2, cd=300)),
    ],
    mats=[('glass_shell', '硝殻', 30), ('claw_core', '鋏芯', 40), ('forming_gland', '成形腺膜', 50), ('glass_greave', '硝脚甲', 35)],
    breaks={'claw_r': [1, 2], 'claw_l': [1], 'plates': [0, 2], 'greave': [3]},
    quest=('硝殻の鋏', '硝殻蟹オルグラスが、風礫盆地の段々に上がってきた。右の大鋏と、横への突進に気をつけて狩る。'),
    route=dict(start='a3', roam=['a3', 'a6', 'a9'], nest='a10'),
))


# ---- 08 鉤輪蟲 テンガロ（多脚甲殻・輪。麻痺）----
def arch_points():
    pts = [[300, 960, 30, 30, 40], [240, 900, 95, 95, 110], [180, 790, 105, 105, 120], [190, 665, 110, 110, 125], [265, 510, 115, 115, 130], [385, 365, 115, 115, 130],
           [560, 250, 115, 115, 130], [748, 205, 115, 115, 130], [935, 205, 115, 115, 130], [1080, 305, 115, 115, 130], [1160, 440, 115, 115, 130],
           [1205, 560, 115, 115, 130], [1240, 670, 112, 112, 125], [1290, 790, 100, 100, 115], [1360, 840, 50, 50, 60]]
    return pts


def arch_frame(pts, i):
    """i 番目の点の、輪の外側への向き（px の平面。上が -y）と、進む向き"""
    a = pts[max(0, i - 1)]
    b = pts[min(len(pts) - 1, i + 1)]
    tx, ty = b[0] - a[0], b[1] - a[1]
    n = math.hypot(tx, ty)
    tx, ty = tx / n, ty / n
    # 進む向き（尾→頭）の左手が外側（画面で上）: (ty, -tx)
    return (ty, -tx), (tx, ty)


S = Sp('tengaro', 0.0037, (760, 965))
TP = arch_points()
T_LEGS, T_HOOKS = [], []
for i in (2, 4, 6, 8, 10, 12):
    (ox_, oy_), (tx_, ty_) = arch_frame(TP, i)
    cx, cy, rr = TP[i][0], TP[i][1], TP[i][2]
    bx, by = cx - ox_ * rr * 0.7, cy - oy_ * rr * 0.7
    mx, my = bx - ox_ * 70 - tx_ * 30, by - oy_ * 70 - ty_ * 30
    ex, ey = mx - ox_ * 60 + tx_ * 20, my - oy_ * 60 + ty_ * 20
    T_LEGS.append(dict(group='A', attach=i, pts=[[round(bx), round(by), 0.3], [round(mx), round(my), 0.42], [round(ex), round(ey), 0.45]], r=[26, 22, 9], mirror=True, phase=i / 12.0))
for i in range(1, 14):
    (ox_, oy_), (tx_, ty_) = arch_frame(TP, i)
    cx, cy, rr = TP[i][0], TP[i][1], TP[i][2]
    ax_, ay_ = cx + ox_ * rr * 0.75, cy + oy_ * rr * 0.75
    bx_, by_ = ax_ + ox_ * 90 - tx_ * 70, ay_ + oy_ * 90 - ty_ * 70
    T_HOOKS.append(dict(kind='cone', bone=f'spine:{i}', a=[round(ax_), round(ay_)], b=[round(bx_), round(by_)], ra=34, rb=3, mirror=True, x=0.26, ch='hooks', part='hooks'))
SPECIES.append(dict(
    sp=S, no=8, name='鉤輪蟲 テンガロ', frame='arch', rig='crust_many',
    plan=dict(
        spine=TP, roles='-aaaaaaaaaaaaa-', root=7,
        legs=T_LEGS,
        extras=[
            *T_HOOKS,
            dict(kind='cone', bone='spine:13', a=[1330, 850], b=[1420, 905], ra=26, rb=4, mirror=True, x=0.14, shade=0.8),
            dict(kind='blob', bone='spine:13', c=[1300, 775], r=[16, 16, 0.05], mirror=True, x=0.3, shade=0.2),
        ],
        stride=1.0, lift=0.12,
    ),
    stats=dict(hp=1800, bodyRadius=0.8, turn=60, moveSpeed=2.4, approach=(4.2, 50), collision=[(1.9, 0.75), (-1.9, 0.75), (1.35, 0.6), (-1.45, 0.6)],
               discover=(14, 130, 6), rage=(450, 2000, 1.25, 1.2, 0.6), cooldown=(50, 100)),
    parts=lambda s: [
        part('head', '頭甲', 'shell', (0.65, 0.7, 0.6), [(s.m(1250, 720), s.m(1370, 850), 0.45)], broken=(0.75, 0.8, 0.7), dur=200, flinch=(160, 60, 50, False)),
        part('hooks', '外側の大鉤', 'shell', (0.45, 0.55, 0.45), [(s.m(270, 560, 0.35), s.m(400, 360, 0.35), 0.4), (s.m(270, 560, -0.35), s.m(400, 360, -0.35), 0.4),
                                                               (s.m(1080, 330, 0.35), s.m(1190, 530, 0.35), 0.4), (s.m(1080, 330, -0.35), s.m(1190, 530, -0.35), 0.4)], broken=(0.6, 0.7, 0.6), dur=240),
        part('lock', '輪留め節', 'hide', (0.75, 0.7, 0.7), [(s.m(190, 760), s.m(200, 640), 0.42), (s.m(1210, 580), s.m(1240, 680), 0.42)], broken=(0.85, 0.8, 0.8), dur=200, flinch=(200, 70, 140, True)),
        part('tail', '尾の痺液管', 'hide', (0.7, 0.65, 0.65), [(s.m(240, 900), s.m(300, 960), 0.38)], broken=(0.8, 0.75, 0.75), dur=170),
        part('body', '体節', 'shell', (0.45, 0.5, 0.45), [(s.m(385, 365), s.m(560, 250), 0.42), (s.m(560, 250), s.m(935, 205), 0.42), (s.m(935, 205), s.m(1080, 305), 0.42)]),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'insect_buzz'), (40, 'hiss')]),
        *[move(f'roll_{"l" if sd > 0 else "r"}', 130, 44, 92, 'roll', side=sd, curve=(11.0, 44, 92), dirDeg=25 * sd,
               tracks=[track(f'tengaro_roll_{"l" if sd > 0 else "r"}', 1.4, 1.8, [(44, [0, 1.25, -0.9], [0, 0, 1]), (92, [0, 1.25, -0.9], [0, 0, 1])])],
               hits=[hit('ring', 44, 92, f'tengaro_roll_{"l" if sd > 0 else "r"}', 26, 'knockdown', cost=40)],
               sounds=[(4, 'insect_buzz'), (44, 'galdros_charge')], ai=ai(6, 18, 40, 1.5, side='left' if sd > 0 else 'right', cd=480, clear=10)) for sd in (1, -1)],
        *[move(f'hook_sweep_{"l" if sd > 0 else "r"}', 90, 36, 46, 'hook_sweep', side=sd,
               tracks=[track(f'tengaro_hook_sweep_{"l" if sd > 0 else "r"}', 0.8, 3.8, [(36, [0.6 * sd, 1.0, -1.9], [0, 0, 1]), (46, [2.0 * sd, 1.0, -1.9], [0, 0, 1])])],
               hits=[hit('hooks', 36, 46, f'tengaro_hook_sweep_{"l" if sd > 0 else "r"}', 18, 'flinch', kind='cut', cost=25, status=('para', 35))],
               sounds=[(4, 'hiss'), (34, 'galdros_swing')], ai=ai(0, 5, 140, 2.5, minA=40, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('arch_drop', 100, 44, 52, 'arch_drop', curve=(1.5, 40, 52), turn=(30, 50), slamTrack='tengaro_arch_drop',
             tracks=[track('tengaro_arch_drop', 1.0, 2.2, [(44, [0, 1.1, 1.6], [0, -0.3, 1]), (52, [0, 0.9, 1.7], [0, -0.35, 1])])],
             hits=[hit('drop', 44, 52, 'tengaro_arch_drop', 26, 'knockdown', cost=40)],
             sounds=[(4, 'insect_buzz'), (42, 'galdros_swing')], vfx=[(50, 'ground_slam')], ai=ai(0, 6, 35, 2.5)),
        move('venom_strike', 100, 42, 48, 'tail_strike',
             tracks=[track('tengaro_venom_strike', 0.7, 1.6, [(42, [0, 1.2, -2.0], [0, -0.8, -0.6]), (48, [0, 1.0, -2.0], [0, -0.85, -0.5])])],
             hits=[hit('tail', 42, 48, 'tengaro_venom_strike', 14, 'flinch', cost=20, status=('para', 45))],
             hazards=[hazard(44, 3, 2.2, 1.4, 36, 20, 8, 'flinch', [0, 1.5, -2.0], 'para', peak=3, status=('para', 55))],
             sounds=[(4, 'hiss'), (42, 'splash')], ai=ai(2, 12, 180, 2, cd=360)),
    ],
    mats=[('hook_shell', '鉤甲', 30), ('ring_segment', '輪節', 25), ('lock_tendon', '輪留め腱', 45), ('venom_duct', '痺液管', 55)],
    breaks={'head': [0], 'hooks': [0, 1], 'lock': [2], 'tail': [3]},
    quest=('輪になる蟲', '霧灯樹海の鉤輪蟲テンガロが、風礫盆地に現れた。輪になって転がる体と、痺れる液に注意。弓なりの体の下は、くぐり抜けられる。'),
    route=dict(start='a7', roam=['a7', 'a3', 'a6'], nest='a10'),
))

# ---- 09 絹霧蟲 ヴェリト（多脚の虫。毒）----
S = Sp('verito', 0.00324, (900, 955))
SPECIES.append(dict(
    sp=S, no=9, name='絹霧蟲 ヴェリト', frame='bug', rig='crust_many',
    plan=dict(
        spine=[[290, 610, 25, 25, 30], [380, 600, 90, 90, 100], [550, 610, 120, 120, 135], [750, 615, 110, 115, 125], [950, 610, 90, 95, 105], [1120, 600, 85, 85, 95], [1290, 570, 75, 75, 80], [1350, 590, 35, 35, 40]],
        roles='-tttbbh-', root=4,
        legs=[
            dict(group='M1', attach=5, pts=[[1150, 650, 0.35], [1320, 730, 0.9], [1430, 900, 1.1], [1440, 945, 1.15]], r=[22, 18, 12, 6], mirror=True, phase=0.0, swing='y'),
            dict(group='M2', attach=5, pts=[[1080, 660, 0.4], [1220, 790, 1.0], [1300, 940, 1.2]], r=[22, 18, 8], mirror=True, phase=0.5, swing='y'),
            dict(group='M3', attach=4, pts=[[950, 660, 0.4], [1000, 720, 1.0], [980, 950, 1.15]], r=[22, 18, 8], mirror=True, phase=0.0, swing='y'),
            dict(group='M4', attach=4, pts=[[860, 660, 0.35], [720, 620, 0.95], [650, 940, 1.1]], r=[22, 18, 8], mirror=True, phase=0.5, swing='y'),
        ],
        extras=[
            dict(kind='blob', bone='own:bag_f', own=dict(name='bag_f', at=[1000, 420], parent='spine:4'), c=[1000, 250], r=[340, 220, 0.62], mirror=True, x=0.5, ch='bags', part='bag'),
            dict(kind='blob', bone='own:bag_b', own=dict(name='bag_b', at=[600, 470], parent='spine:3'), c=[580, 360], r=[260, 150, 0.45], mirror=True, x=0.4, ch='bags', part='bag'),
            dict(kind='cone', bone='spine:6', a=[1330, 505], b=[1490, 365], ra=8, rb=3, mirror=True, x=0.08),
            dict(kind='cone', bone='spine:6', a=[1340, 525], b=[1520, 440], ra=7, rb=3, mirror=True, x=0.05),
            *[dict(kind='cone', bone='spine:1', a=[300, 610], b=b, ra=10, rb=2, x=x, ch='tubes', part='spinner') for b, x in (([40, 600], 0.0), ([60, 700], 0.08), ([80, 780], -0.08), ([60, 560], 0.04))],
            dict(kind='blob', bone='spine:6', c=[1300, 545], r=[16, 16, 0.05], mirror=True, x=0.17, shade=0.25),
        ],
        stride=1.2, lift=0.2,
    ),
    stats=dict(hp=1400, bodyRadius=1.0, turn=85, moveSpeed=2.8, approach=(3.8, 50), collision=[(0.2, 1.0), (-1.2, 0.8)],
               discover=(14, 130, 6), rage=(380, 1800, 1.3, 1.15, 0.6), cooldown=(45, 95)),
    parts=lambda s: [
        part('bag_l', '左の羽袋', 'hide', (0.85, 0.75, 0.8), [(s.m(700, 280, 0.5), s.m(1250, 250, 0.5), 0.55)], broken=(0.95, 0.85, 0.9), dur=170),
        part('bag_r', '右の羽袋', 'hide', (0.85, 0.75, 0.8), [(s.m(700, 280, -0.5), s.m(1250, 250, -0.5), 0.55)], broken=(0.95, 0.85, 0.9), dur=170),
        part('spinner', '尾の紡糸管', 'hide', (0.7, 0.6, 0.65), [(s.m(420, 600), s.m(200, 610), 0.3)], broken=(0.8, 0.7, 0.75), dur=160),
        part('comb', '前脚の糸櫛', 'shell', (0.6, 0.6, 0.55), [(s.m(1150, 660, 0.4), s.m(1430, 900, 1.1), 0.15), (s.m(1150, 660, -0.4), s.m(1430, 900, -1.1), 0.15)], broken=(0.7, 0.7, 0.65), dur=150, flinch=(160, 60, 110, True)),
        part('head', '頭', 'hide', (0.75, 0.7, 0.7), [(s.m(1260, 575), s.m(1360, 590), 0.27)], flinch=(130, 50, 45, False)),
        part('body', '胴', 'shell', (0.5, 0.5, 0.45), [(s.m(400, 605), s.m(1150, 600), 0.42)]),
        part('legs', '脚', 'shell', (0.45, 0.5, 0.4), [(s.m(950, 660, 0.4), s.m(980, 940, 1.15), 0.12), (s.m(950, 660, -0.4), s.m(980, 940, -1.15), 0.12), (s.m(860, 660, 0.35), s.m(650, 930, 1.1), 0.12), (s.m(860, 660, -0.35), s.m(650, 930, -1.1), 0.12)], flinch=(200, 70, 120, True)),
    ],
    moves=lambda s: [
        move('roar', 90, 90, 90, 'roar', sounds=[(8, 'insect_buzz')]),
        move('thread_spray', 110, 46, 62, 'spray_rear',
             tracks=[track('verito_thread_spray', 0.7, 3.4, [(46, [0, 0.5, -2.0], [-1, 0, -0.45]), (54, [0, 0.5, -2.0], [0, 0, -1]), (62, [0, 0.5, -2.0], [1, 0, -0.45])])],
             hits=[hit('threads', 46, 62, 'verito_thread_spray', 8, 'flinch', cost=15, status=('poison', 70))],
             sounds=[(4, 'hiss'), (46, 'gust')], vfx=[(46, 'poison_threads')], ai=ai(0, 6, 180, 2.5, minA=100, cd=300)),
        move('hop', 100, 46, 54, 'leap', curve=(5.0, 34, 52), slamTrack='verito_hop',
             tracks=[track('verito_hop', 1.3, 1.2, [(46, [0, 0.6, 0.4], [0, 0, 1]), (54, [0, 0.6, 0.4], [0, 0, 1])])],
             hits=[hit('land', 46, 54, 'verito_hop', 22, 'knockdown', cost=35)],
             sounds=[(4, 'insect_buzz'), (34, 'gust')], vfx=[(52, 'ground_slam')], ai=ai(4, 10, 30, 2, cd=300, clear=6)),
        move('foreleg_sweep', 80, 32, 42, 'foreleg_sweep', turn=(24, 80),
             tracks=[track('verito_foreleg_sweep', 0.55, 2.3, [(32, [0, 0.9, 1.4], [-1, 0, 0.6]), (37, [0, 0.9, 1.4], [0, 0, 1]), (42, [0, 0.9, 1.4], [1, 0, 0.6])])],
             hits=[hit('legs', 32, 42, 'verito_foreleg_sweep', 16, 'flinch', kind='cut', cost=25, status=('poison', 35))],
             sounds=[(30, 'galdros_swing')], ai=ai(0, 4.5, 50, 3)),
        move('drip', 100, 40, 44, 'drip',
             hazards=[hazard(42, 4, 2.5, 1.2, 30, 24, 6, 'flinch', [0, 1.5, -1.6], 'poison', peak=2.5, status=('poison', 60))],
             sounds=[(4, 'hiss'), (40, 'splash')], ai=ai(0, 7, 180, 2, cd=300)),
    ],
    mats=[('mist_silk', '霧糸', 25), ('wing_bag', '羽袋', 35), ('venom_fluid', '毒紡液', 50), ('comb_shell', '糸櫛甲', 40)],
    breaks={'bag_l': [1], 'bag_r': [1], 'spinner': [0, 2], 'comb': [3]},
    quest=('霧糸の巣', '絹霧蟲ヴェリトが、風礫盆地の岩間に糸を張った。尾の糸と、足元に落ちる毒の滴に注意。'),
    route=dict(start='a4', roam=['a4', 'a2', 'a3'], nest='a10'),
))

# ---- 10 環骨蛇 ラズメル（長胴獣）----
S = Sp('razmer', 0.00477, (900, 715))
SPECIES.append(dict(
    sp=S, no=10, name='環骨蛇 ラズメル', frame='serpent', rig='long',
    plan=dict(
        spine=[[28, 555, 6, 6, 8], [150, 548, 22, 22, 26], [300, 548, 38, 38, 45], [500, 470, 92, 96, 110], [700, 455, 165, 180, 190], [900, 460, 185, 190, 200],
               [1100, 460, 175, 175, 190], [1300, 455, 150, 160, 175], [1450, 425, 105, 100, 115], [1580, 395, 70, 65, 80], [1680, 390, 55, 50, 60], [1740, 395, 25, 25, 30]],
        roles='-tttbbbbnnh-', root=5,
        legs=[
            dict(group='F', attach=7, pts=[[1260, 560, 0.55], [1240, 620, 0.95], [1300, 695, 1.05]], r=[55, 45, 35], mirror=True, phase=0.0, foot=[160, 25]),
            dict(group='H', attach=4, pts=[[560, 550, 0.5], [520, 620, 0.9], [500, 690, 1.0]], r=[55, 45, 35], mirror=True, phase=0.5, foot=[160, 25]),
        ],
        extras=[dict(kind='blob', bone='spine:10', c=[1700, 370], r=[10, 9, 0.03], mirror=True, x=0.2, shade=0.25)],
        stride=1.6, lift=0.18,
    ),
    stats=dict(hp=1900, bodyRadius=0.95, turn=60, moveSpeed=2.6, approach=(4.8, 45), collision=[(0.0, 1.0), (1.4, 0.9), (2.8, 0.6), (-1.3, 0.85), (-2.6, 0.5)],
               discover=(15, 120, 6), rage=(480, 2100, 1.25, 1.25, 0.6), cooldown=(50, 100)),
    parts=lambda s: [
        part('head', '頭骨', 'rock', (0.6, 0.65, 0.55), [(s.m(1600, 395), s.m(1745, 395), 0.32)], broken=(0.7, 0.75, 0.65), dur=220, flinch=(160, 60, 50, False)),
        part('ring_f', '前の骨環', 'rock', (0.45, 0.6, 0.45), [(s.m(1200, 455), s.m(1420, 435), 0.85)], broken=(0.6, 0.75, 0.6), dur=260),
        part('ring_b', '後ろの骨環', 'rock', (0.45, 0.6, 0.45), [(s.m(650, 455), s.m(880, 460), 0.85)], broken=(0.6, 0.75, 0.6), dur=260),
        part('tail_ring', '尾端環', 'rock', (0.55, 0.6, 0.5), [(s.m(300, 548), s.m(40, 555), 0.2)], broken=(0.65, 0.7, 0.6), dur=170),
        part('body', '胴', 'hide', (0.55, 0.5, 0.5), [(s.m(880, 460), s.m(1200, 455), 0.85), (s.m(450, 480), s.m(650, 455), 0.5)]),
        part('legs', '脚', 'hide', (0.5, 0.5, 0.45), [(s.m(1260, 560, 0.6), s.m(1300, 690, 1.0), 0.25), (s.m(1260, 560, -0.6), s.m(1300, 690, -1.0), 0.25),
                                                      (s.m(560, 550, 0.55), s.m(500, 690, 0.95), 0.25), (s.m(560, 550, -0.55), s.m(500, 690, -0.95), 0.25)], flinch=(220, 80, 130, True)),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'hiss'), (30, 'galdros_rumble')]),
        *[move(f'body_sweep_{"l" if sd > 0 else "r"}', 100, 40, 54, 'sweep_body', side=sd,
               tracks=[track(f'razmer_body_sweep_{"l" if sd > 0 else "r"}', 0.9, 3.4, [(40, [0, 1.0, 1.2], [1 * sd, 0, 0.3]), (47, [0, 1.0, 1.2], [0, 0, 1]), (54, [0, 1.0, 1.2], [-1 * sd, 0, 0.3])])],
               hits=[hit('body', 40, 54, f'razmer_body_sweep_{"l" if sd > 0 else "r"}', 26, 'knockdown', cost=40)],
               sounds=[(4, 'hiss'), (38, 'galdros_swing')], ai=ai(0, 6, 110, 2.5, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('crawl_charge', 120, 40, 84, 'crawl_charge', curve=(13.0, 40, 84),
             tracks=[track('razmer_crawl_charge', 1.1, 2.0, [(40, [0, 1.0, 2.6], [0, 0, 1]), (84, [0, 1.0, 2.6], [0, 0, 1])])],
             hits=[hit('head', 40, 84, 'razmer_crawl_charge', 28, 'knockdown', cost=45)],
             sounds=[(4, 'hiss'), (40, 'galdros_charge')], ai=ai(6, 22, 25, 2, cd=480, clear=14)),
        move('ring_slam', 100, 46, 54, 'ring_slam', turn=(30, 50), slamTrack='razmer_ring_slam',
             tracks=[track('razmer_ring_slam', 1.0, 2.4, [(0, [0, 2.0, 1.6], [0, 0.5, 0.8]), (46, [0, 2.0, 1.6], [0, 0.5, 0.8]), (50, [0, 2.0, 1.8], [0, -0.8, 0.6]), (54, [0, 2.0, 1.8], [0, -0.85, 0.5])])],
             hits=[hit('ring', 46, 54, 'razmer_ring_slam', 30, 'knockdown', cost=45)],
             sounds=[(4, 'galdros_warn'), (44, 'galdros_swing')], vfx=[(52, 'ground_slam')], ai=ai(0, 5.5, 35, 2.5)),
        *[move(f'tail_wrap_{"l" if sd > 0 else "r"}', 100, 40, 54, 'sweep_tail', side=-sd,
               tracks=[track(f'razmer_tail_wrap_{"l" if sd > 0 else "r"}', 0.6, 3.4, [(40, [0, 0.8, -1.8], [0, 0, -1]), (54, [0, 0.8, -1.8], [1 * sd, 0, -0.2])])],
               hits=[hit('tail', 40, 54, f'razmer_tail_wrap_{"l" if sd > 0 else "r"}', 24, 'knockdown', cost=35)],
               sounds=[(4, 'hiss'), (38, 'galdros_swing')], ai=ai(0, 6, 180, 2.5, minA=70, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
    ],
    mats=[('ring_bone', '環骨', 30), ('vibration_gland', '振動腺', 50), ('ring_ligament', '環間靭帯', 40), ('tail_bone', '尾端骨', 35)],
    breaks={'head': [0], 'ring_f': [0, 1], 'ring_b': [0, 2], 'tail_ring': [3]},
    quest=('骨環の這い跡', '氷帆峡谷から、環骨蛇ラズメルが風礫盆地へ這い出てきた。長い体の薙ぎ払いと、一直線の突進に注意。'),
    route=dict(start='a2', roam=['a2', 'a3', 'a7'], nest='a10'),
))

# ---- 11 氷帆蛇 キリサーヴ（長胴獣。氷）----
S = Sp('kirisave', 0.0055, (950, 615))
SAILS = [([[1460, 395], [1560, 378], [1440, 275]], 0.12), ([[1180, 450], [1450, 405], [1350, 260], [1130, 255]], -0.15), ([[950, 470], [1180, 455], [1090, 320], [860, 315]], 0.15),
         ([[730, 480], [950, 480], [860, 360], [660, 345]], -0.15), ([[560, 488], [730, 488], [650, 400], [520, 395]], 0.13), ([[420, 495], [560, 495], [500, 425], [380, 420]], -0.12),
         ([[280, 500], [420, 500], [360, 440], [250, 432]], 0.1), ([[150, 497], [280, 500], [230, 460], [130, 455]], -0.08)]
SPECIES.append(dict(
    sp=S, no=11, name='氷帆蛇 キリサーヴ', frame='serpent', rig='long',
    plan=dict(
        spine=[[30, 490, 5, 5, 6], [150, 495, 18, 18, 22], [300, 505, 32, 35, 40], [500, 505, 45, 50, 55], [700, 515, 60, 65, 70], [900, 520, 70, 72, 80],
               [1100, 505, 75, 78, 85], [1300, 465, 78, 80, 85], [1450, 420, 70, 72, 75], [1560, 385, 58, 58, 60], [1660, 365, 50, 48, 50], [1745, 375, 15, 15, 15]],
        roles='-ttttbbbnnh-', root=5,
        legs=[],
        extras=[
            *[dict(kind='sheet', bone='own:sail%d' % i, own=dict(name='sail%d' % i, at=[(pts[0][0] + pts[1][0]) // 2, (pts[0][1] + pts[1][1]) // 2], parent='chain'),
                   x=x, tilt=0.25, thick=0.05, ch='sail', part='sails_l' if x > 0 else 'sails_r', pts=pts) for i, (pts, x) in enumerate(SAILS)],
            dict(kind='sheet', bone='spine:6', mirror=True, x=0.35, tilt=0.9, thick=0.04, pts=[[1100, 560], [1220, 565], [1150, 630], [1000, 640]]),
            dict(kind='sheet', bone='spine:4', mirror=True, x=0.3, tilt=0.9, thick=0.04, pts=[[650, 540], [760, 545], [700, 580], [620, 590]]),
            dict(kind='blob', bone='spine:10', c=[1690, 350], r=[10, 9, 0.03], mirror=True, x=0.2, shade=0.25),
        ],
        stride=2.0, lift=0.0,
    ),
    stats=dict(hp=1850, bodyRadius=0.8, turn=55, moveSpeed=2.6, approach=(5.0, 45), collision=[(0.0, 0.8), (1.6, 0.75), (3.2, 0.6), (-1.6, 0.6), (-3.2, 0.4)],
               discover=(15, 120, 6), rage=(470, 2100, 1.25, 1.2, 0.6), cooldown=(50, 100)),
    parts=lambda s: [
        part('head', '頭の冷晶板', 'shell', (0.65, 0.7, 0.6), [(s.m(1600, 375), s.m(1745, 375), 0.3)], broken=(0.75, 0.8, 0.7), dur=200, flinch=(150, 60, 50, False)),
        part('sails_l', '左列の氷帆', 'shell', (0.55, 0.65, 0.5), [(s.m(1350, 330, 0.2), s.m(600, 420, 0.2), 0.42)], broken=(0.7, 0.8, 0.65), dur=230),
        part('sails_r', '右列の氷帆', 'shell', (0.55, 0.65, 0.5), [(s.m(1350, 330, -0.2), s.m(600, 420, -0.2), 0.42)], broken=(0.7, 0.8, 0.65), dur=230),
        part('tail', '尾の冷晶管', 'hide', (0.6, 0.55, 0.55), [(s.m(450, 505), s.m(60, 492), 0.22)], broken=(0.7, 0.65, 0.65), dur=170),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(500, 505), s.m(1500, 420), 0.45)]),
    ],
    moves=lambda s: [
        move('roar', 100, 100, 100, 'roar', sounds=[(10, 'hiss'), (40, 'ice_crack')]),
        move('ice_row', 120, 58, 62, 'ice_row', turn=(40, 60),
             hazards=[hazard(58, 6, 0.5, 1.1, 32, 8, 18, 'flinch', [0, 1.6, 2.0], 'ice', peak=2.5, pattern='line')],
             sounds=[(6, 'ice_crack'), (56, 'ice_crack')], ai=ai(5, 18, 45, 2.5, cd=360)),
        move('slide', 110, 40, 70, 'slide', curve=(9.0, 40, 70),
             tracks=[track('kirisave_slide', 1.0, 2.0, [(40, [0, 0.6, 2.8], [0, 0, 1]), (70, [0, 0.6, 2.8], [0, 0, 1])])],
             hits=[hit('head', 40, 70, 'kirisave_slide', 24, 'knockdown', cost=35)],
             sounds=[(4, 'hiss'), (40, 'galdros_charge')], ai=ai(2.5, 16, 25, 2.5, cd=300, clear=10)),
        *[move(f'body_sweep_{"l" if sd > 0 else "r"}', 90, 36, 48, 'sweep_body_side', side=sd,
               tracks=[track(f'kirisave_body_sweep_{"l" if sd > 0 else "r"}', 0.7, 4.6, [(36, [0.5 * sd, 0.8, -2.2], [0, 0, 1]), (48, [1.8 * sd, 0.8, -1.8], [0.15 * sd, 0, 1])])],
               hits=[hit('body', 36, 48, f'kirisave_body_sweep_{"l" if sd > 0 else "r"}', 20, 'flinch', cost=30)],
               sounds=[(4, 'ice_crack'), (34, 'galdros_swing')], ai=ai(0, 5, 140, 2.5, minA=40, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('tail_slam', 110, 50, 58, 'tail_strike', slamTrack='kirisave_tail_slam',
             tracks=[track('kirisave_tail_slam', 0.8, 2.4, [(50, [0, 2.0, -3.2], [0, -0.85, -0.5]), (58, [0, 1.8, -3.3], [0, -0.9, -0.4])])],
             hits=[hit('tail', 50, 58, 'kirisave_tail_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (48, 'galdros_swing')], vfx=[(56, 'ground_slam')], ai=ai(0, 7, 180, 2.5, minA=120)),
    ],
    mats=[('ice_sail', '氷帆', 30), ('cold_crystal', '冷晶', 40), ('crystal_duct', '冷晶管', 50), ('sail_skin', '帆間皮', 25)],
    breaks={'head': [1], 'sails_l': [0, 3], 'sails_r': [0, 3], 'tail': [2]},
    quest=('氷帆の列', '氷帆蛇キリサーヴが、風礫盆地へ下りてきた。背の氷帆が順に立ったら、氷の欠片が列になって落ちる。'),
    route=dict(start='a6', roam=['a6', 'a3', 'a2'], nest='a10'),
))

# ---- 12 霧灯獣 ヴェルガイト（四足軽獣。霧）----
S = Sp('velgait', 0.00386, (880, 972))
LAMPS = [(694, 327), (788, 327), (874, 340), (961, 350), (1045, 340), (1121, 330)]
SPECIES.append(dict(
    sp=S, no=12, name='霧灯獣 ヴェルガイト', frame='quad', rig='quadruped_light',
    plan=dict(
        spine=[[227, 434, 3, 3, 3], [120, 481, 6, 6, 6], [53, 601, 9, 9, 9], [147, 681, 12, 12, 12], [267, 667, 16, 16, 16], [400, 587, 22, 22, 22], [520, 440, 35, 38, 34],
               [620, 470, 110, 120, 95], [880, 455, 105, 105, 90], [1130, 465, 115, 130, 100], [1230, 390, 70, 75, 65], [1290, 300, 55, 55, 50], [1340, 255, 55, 55, 50], [1410, 330, 22, 22, 22]],
        roles='-ttttttbbbnnh-', root=8,
        legs=[
            dict(group='F', attach=9, pts=[[1160, 560, 0.3], [1205, 790, 0.3], [1285, 925, 0.3], [1340, 965, 0.3]], r=[50, 26, 18, 13], mirror=True, phase=0.0, foot=[45, 22]),
            dict(group='H', attach=7, pts=[[600, 545, 0.3], [565, 790, 0.3], [665, 945, 0.3], [710, 968, 0.3]], r=[66, 28, 18, 13], mirror=True, phase=0.5, foot=[45, 22]),
        ],
        extras=[
            dict(kind='torus', bone='own:crown', own=dict(name='crown', at=[1240, 250], parent='spine:12'), c=[1258, 125], ring=122, tube=17, ch='crown', part='crown'),
            dict(kind='cone', bone='own:crown', a=[1225, 255], b=[1205, 205], ra=13, rb=9, mirror=True, x=0.07),
            dict(kind='cone', bone='spine:12', a=[1300, 215], b=[1255, 145], ra=24, rb=3, mirror=True, x=0.13),
            *[dict(kind='blob', bone='chain', c=[x, y], r=[33, 24, 0.12], glow=True, **({'part': 'lamps_f'} if x > 1000 else {'part': 'lamps_b'} if x < 800 else {})) for x, y in LAMPS],
            dict(kind='blob', bone='spine:12', c=[1350, 235], r=[10, 9, 0.03], mirror=True, x=0.13, shade=0.25),
        ],
        stride=2.0, lift=0.24, glowColor=[0.6, 0.95, 0.85],
    ),
    stats=dict(hp=1550, bodyRadius=0.85, turn=105, moveSpeed=3.3, approach=(4.2, 50), collision=[(0.0, 0.7), (1.0, 0.55), (-1.0, 0.55)],
               discover=(17, 140, 6), rage=(400, 1800, 1.3, 1.15, 0.6), cooldown=(45, 90)),
    parts=lambda s: [
        part('crown', '頭の環冠', 'shell', (0.7, 0.7, 0.65), [(s.m(1180, 160), s.m(1340, 120), 0.35)], broken=(0.8, 0.8, 0.75), dur=170, flinch=(140, 50, 45, False)),
        part('lamps_f', '前の灯節二つ', 'shell', (0.75, 0.7, 0.75), [(s.m(1045, 340), s.m(1121, 330), 0.2)], broken=(0.85, 0.8, 0.85), dur=150),
        part('lamps_b', '後ろの灯節二つ', 'shell', (0.75, 0.7, 0.75), [(s.m(694, 327), s.m(788, 327), 0.2)], broken=(0.85, 0.8, 0.85), dur=150),
        part('tail', '尾の導霧皮', 'hide', (0.6, 0.5, 0.55), [(s.m(400, 587), s.m(147, 681), 0.12), (s.m(147, 681), s.m(120, 481), 0.1)], broken=(0.7, 0.6, 0.65), dur=150),
        part('head', '頭', 'hide', (0.75, 0.7, 0.65), [(s.m(1290, 290), s.m(1410, 330), 0.24)], flinch=(140, 50, 45, False)),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(620, 470), s.m(1130, 465), 0.42), (s.m(1230, 390), s.m(1290, 300), 0.2)]),
        part('legs', '脚', 'hide', (0.45, 0.45, 0.4), [(s.m(1160, 580, 0.3), s.m(1285, 925, 0.3), 0.14), (s.m(1160, 580, -0.3), s.m(1285, 925, -0.3), 0.14),
                                                       (s.m(600, 560, 0.3), s.m(665, 940, 0.3), 0.15), (s.m(600, 560, -0.3), s.m(665, 940, -0.3), 0.15)], flinch=(210, 70, 120, True)),
    ],
    moves=lambda s: [
        move('roar', 90, 90, 90, 'roar', sounds=[(8, 'beast_cry'), (30, 'mist_pop')]),
        move('mist_ball', 110, 50, 54, 'mist_ball', turn=(36, 70),
             hazards=[hazard(52, 2, 3.0, 2.4, 70, 10, 20, 'knockdown', s.m(1258, 125), 'mist', peak=2.5)],
             sounds=[(6, 'mist_pop'), (50, 'mist_pop')], ai=ai(5, 16, 45, 2.5, cd=300)),
        *[move(f'side_thrust_{"l" if sd > 0 else "r"}', 85, 32, 42, 'hop_side', side=sd, curve=(2.4, 28, 44), dirDeg=60 * sd,
               tracks=[track(f'velgait_side_thrust_{"l" if sd > 0 else "r"}', 0.5, 1.9, [(32, [0.3 * sd, 1.9, 1.2], [0.6 * sd, -0.2, 0.8]), (42, [0.4 * sd, 1.8, 1.3], [0.7 * sd, -0.25, 0.7])])],
               hits=[hit('head', 32, 42, f'velgait_side_thrust_{"l" if sd > 0 else "r"}', 20, 'flinch', kind='cut', cost=25)],
               sounds=[(4, 'galdros_warn'), (30, 'galdros_swing')], ai=ai(2, 7, 120, 2.5, minA=30, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
        move('stomp', 95, 42, 50, 'stomp_front', turn=(30, 70), slamTrack='velgait_stomp',
             tracks=[track('velgait_stomp', 0.8, 2.3, [(0, [0, 2.4, 1.6], [0, -0.3, 1]), (42, [0, 2.4, 1.6], [0, -0.3, 1]), (46, [0, 2.3, 1.7], [0, -1, 0.2]), (50, [0, 2.3, 1.7], [0, -1, 0.15])])],
             hits=[hit('fore', 42, 50, 'velgait_stomp', 26, 'knockdown', cost=40)],
             sounds=[(4, 'beast_cry'), (40, 'galdros_swing')], vfx=[(48, 'ground_slam')], ai=ai(0, 4.5, 35, 3)),
        *[move(f'tail_sweep_{"l" if sd > 0 else "r"}', 95, 38, 52, 'sweep_tail', side=sd,
               tracks=[track(f'velgait_tail_sweep_{"l" if sd > 0 else "r"}', 0.5, 2.8, [(38, [0, 1.3, -1.0], [1 * sd, -0.1, -0.2]), (45, [0, 1.3, -1.0], [0, -0.1, -1]), (52, [0, 1.3, -1.0], [-1 * sd, -0.1, -0.2])])],
               hits=[hit('tail', 38, 52, f'velgait_tail_sweep_{"l" if sd > 0 else "r"}', 20, 'knockdown', cost=30)],
               sounds=[(4, 'galdros_warn'), (36, 'galdros_swing')], ai=ai(0, 4.6, 180, 2.5, minA=60, side='left' if sd > 0 else 'right')) for sd in (1, -1)],
    ],
    mats=[('mist_lamp', '霧灯晶', 45), ('tough_hide', '靭皮', 25), ('crown_shard', '環冠片', 50), ('mist_pore', '凝霧孔膜', 40)],
    breaks={'crown': [2], 'lamps_f': [0], 'lamps_b': [0, 3], 'tail': [1, 3]},
    quest=('霧灯の夜', '霧灯樹海の霧灯獣ヴェルガイトが、風礫盆地に迷い込んだ。頭冠の灯が灯ったら、遅れて霧の球が弾ける。'),
    route=dict(start='a9', roam=['a9', 'a6', 'a7'], nest='a10'),
))


# ---------------------------------------------------------------------------------------------
# 書き出し
# ---------------------------------------------------------------------------------------------

def dump_lines(obj_list, indent='    '):
    return (',\n').join(indent + json.dumps(o, ensure_ascii=False) for o in obj_list)


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(text)


def smooth_curve(cid, dur, dist, t0, t1):
    """t0〜t1 で dist 進む（なめらかに加速・減速）"""
    keys = [[0, 0]]
    if t0 > 0:
        keys.append([t0, 0])
    ts = list(range(t0 + 2, t1, 2)) + [t1]
    for t in ts:
        u = (t - t0) / (t1 - t0)
        e = u * u * (3 - 2 * u)
        keys.append([t, r3(dist * e)])
    if dur > t1:
        keys.append([dur, r3(dist)])
    return {'id': cid, 'keys': keys}


def build_species(spec):
    s = spec['sp']
    key = s.key
    mid = f'monster.{key}'
    st = spec['stats']
    moves = spec['moves'](s)
    actions, tracks, curves, choices, clips, plan_moves = [], [], [], [], [], {}
    for mv in moves:
        aid = f'{mid}.{mv["name"]}'
        clip = f'{key}_{mv["name"]}_01'
        clips.append(clip)
        dur, a0, a1 = mv['dur'], mv['startup'], mv['active']
        if a0 >= dur:
            phases = [{'id': 'startup', 'from': 0, 'to': dur}]
        else:
            phases = [{'id': 'startup', 'from': 0, 'to': a0}, {'id': 'active', 'from': a0, 'to': a1}, {'id': 'recovery', 'from': a1, 'to': dur}]
        rm = {'mode': 'none'}
        if mv['curve']:
            dist, t0, t1 = mv['curve']
            cid = f'm_{key}_{mv["name"]}'
            curves.append(smooth_curve(cid, dur, dist, t0, t1))
            rm = {'mode': 'controller', 'curveId': cid}
            if mv['dirDeg']:
                rm['dirDeg'] = mv['dirDeg']
        a = {'schemaVersion': 1, 'actionId': aid, 'clip': clip, 'tickRate': 60, 'durationTicks': dur, 'phases': phases, 'rootMotion': rm}
        if mv['turn']:
            a['turning'] = {'untilTick': mv['turn'][0], 'maxDegreesPerSecond': mv['turn'][1]}
        a['hitWindows'] = mv['hits']
        a['cancelWindows'] = []
        ev = [{'tick': t, 'type': 'sound', 'id': i} for t, i in mv['sounds']] + [{'tick': t, 'type': 'vfx', 'id': i} for t, i in mv['vfx']]
        a['events'] = sorted(ev, key=lambda e: e['tick'])
        a['onFinish'] = 'keep'
        if mv['hazards']:
            a['hazards'] = mv['hazards']
        if mv['slamTrack']:
            a['weaponTrack'] = mv['slamTrack']
        actions.append(a)
        tracks.extend(mv['tracks'])
        if mv['ai']:
            choices.append({'actionId': aid, **mv['ai']})
        pm = {'kind': mv['anim']}
        if mv['side']:
            pm['side'] = mv['side']
        if mv['amp']:
            pm['amp'] = mv['amp']
        plan_moves[clip] = pm
    roar = f'{mid}.roar'
    mdef = {
        'schemaVersion': 1, 'id': mid, 'name': spec['name'], 'rigFamily': spec['rig'], 'assetId': f'model.monster.{key}',
        'hp': st['hp'], 'bodyRadius': st['bodyRadius'], 'turnDegPerSec': st['turn'], 'moveSpeed': st['moveSpeed'], 'captureAllowed': True,
        'lootId': f'loot.{key}', 'capture': {'hpRatio': 0.25, 'tranqNeeded': 2, 'tranqDecayTicks': 900}, 'respawnTicks': None, 'breakStaggerTicks': 80,
        'collision': [{'z': z, 'r': r} for z, r in st['collision']],
        'approach': {'stopDist': st['approach'][0], 'faceDeg': st['approach'][1]},
        'discover': {'range': st['discover'][0], 'fovDeg': st['discover'][1], 'closeRange': st['discover'][2], 'actionId': roar},
        'rage': {'threshold': st['rage'][0], 'durationTicks': st['rage'][1], 'actionId': roar, 'speedScale': st['rage'][2], 'damageScale': st['rage'][3], 'cooldownScale': st['rage'][4]},
        'parts': spec['parts'](s),
        'ai': {'aggroRange': 200, 'cooldownTicks': list(st['cooldown']), 'choices': choices},
    }
    return mdef, actions, tracks, curves, clips, plan_moves


def monster_json(m):
    lines = ['{']
    keys = [k for k in m if k not in ('parts', 'ai')]
    for k in keys:
        lines.append(f'  {json.dumps(k)}: {json.dumps(m[k], ensure_ascii=False)},')
    lines.append('  "parts": [')
    lines.append(dump_lines(m['parts']))
    lines.append('  ],')
    ai_ = m['ai']
    lines.append('  "ai": {')
    lines.append(f'    "aggroRange": {ai_["aggroRange"]},')
    lines.append(f'    "cooldownTicks": {json.dumps(ai_["cooldownTicks"])},')
    lines.append('    "choices": [')
    lines.append(dump_lines(ai_['choices'], '      '))
    lines.append('    ]')
    lines.append('  }')
    lines.append('}')
    return '\n'.join(lines) + '\n'


def list_doc(head, key, items):
    out = ['{']
    for k, v in head.items():
        out.append(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},')
    out.append(f'  {json.dumps(key)}: [')
    out.append(dump_lines(items))
    out.append('  ]')
    out.append('}')
    return '\n'.join(out) + '\n'


def replace_rows(path, list_key, prefixes, rows):
    """1 行 1 件の JSON の一覧（list_key の中）から、id / itemId が prefixes で始まる行を除き、rows を最後へ足す。"""
    full = os.path.join(ROOT, path)
    text = open(full, encoding='utf-8').read()
    lines = text.split('\n')
    start = next(i for i, l in enumerate(lines) if l.strip().startswith(f'"{list_key}": ['))
    end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() in (']', '],'))
    body = [l for l in lines[start + 1:end] if l.strip()]
    keep = []
    for l in body:
        m = re.search(r'"(?:id|itemId)": "([^"]+)"', l)
        if m and any(m.group(1).startswith(p) for p in prefixes):
            continue
        keep.append(l.rstrip(','))
    indent = re.match(r'\s*', body[0]).group(0) if body else '    '
    allrows = keep + [indent + json.dumps(r, ensure_ascii=False) for r in rows]
    new = lines[:start + 1] + [r + (',' if i < len(allrows) - 1 else '') for i, r in enumerate(allrows)] + lines[end:]
    open(full, 'w', encoding='utf-8').write('\n'.join(new))


def update_manifest(entries):
    full = os.path.join(ROOT, 'docs', 'asset-manifest.json')
    lines = open(full, encoding='utf-8').read().split('\n')
    ids = {e['id'] for e in entries}
    out = []
    for l in lines:
        m = re.match(r'\s*\{ "id": "([^"]+)"', l)
        if m and m.group(1) in ids:
            continue
        out.append(l)
    end = max(i for i, l in enumerate(out) if l.strip() == ']')
    last = end - 1
    while not out[last].strip():
        last -= 1
    if not out[last].rstrip().endswith(','):
        out[last] = out[last].rstrip() + ','
    rows = ['    ' + json.dumps(e, ensure_ascii=False).replace('{"', '{ "', 1)[:-1] + ' }' for e in entries]
    rows = [r + (',' if i < len(rows) - 1 else '') for i, r in enumerate(rows)]
    out = out[:last + 1] + rows + out[last + 1:]
    json.loads('\n'.join(out))
    open(full, 'w', encoding='utf-8').write('\n'.join(out))


def update_bestiary(states):
    full = os.path.join(DATA, 'bestiary.json')
    lines = open(full, encoding='utf-8').read().split('\n')
    done = set()
    for i, l in enumerate(lines):
        m = re.search(r'"id":"(monster\.[a-z_]+)"', l)
        if not m or m.group(1) not in states:
            continue
        tail = ',' if l.rstrip().endswith(',') else ''
        body = l.strip().rstrip(',')
        obj = json.loads(body)
        obj['state'] = 'implemented'
        obj['stateNote'] = states[m.group(1)]
        indent = re.match(r'\s*', l).group(0)
        lines[i] = indent + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + tail
        done.add(m.group(1))
    assert done == set(states), set(states) - done
    json.loads('\n'.join(lines))
    open(full, 'w', encoding='utf-8').write('\n'.join(lines))


def update_content_index(add):
    full = os.path.join(DATA, 'content.json')
    idx = json.load(open(full, encoding='utf-8'))
    for k, files in add.items():
        cur = idx['files'][k]
        cur = cur if isinstance(cur, list) else [cur]
        for f in files:
            if f not in cur:
                cur.append(f)
        idx['files'][k] = cur
    text = json.dumps(idx, ensure_ascii=False, indent=2)
    open(full, 'w', encoding='utf-8').write(text)


def ts_value(v, indent=0):
    """設計図を TS のオブジェクトの書き方で（1 項目 1 行に近い形）"""
    return json.dumps(v, ensure_ascii=False)


def main():
    all_curves, quests, mats, loots, sells, manifest, states, plans = [], [], [], [], [], [], {}, []
    actions_files, tracks_files, monster_files = [], [], []
    for spec in SPECIES:
        s = spec['sp']
        key = s.key
        mdef, actions, tracks, curves, clips, plan_moves = build_species(spec)
        write(f'public/data/monsters/{key}.json', monster_json(mdef))
        write(f'public/data/actions/{key}.json', list_doc({'schemaVersion': 1, 'note': f'{spec["name"]}の技（tools/gen-monsters.py の出力。手で編集しない）。数値は机上の値。'}, 'actions', actions))
        write(f'public/data/tracks/{key}.json', list_doc({'schemaVersion': 1, 'note': f'{spec["name"]}の攻撃の判定の形（tools/gen-monsters.py の出力。手で編集しない）。'}, 'tracks', tracks))
        actions_files.append(f'actions/{key}.json')
        tracks_files.append(f'tracks/{key}.json')
        monster_files.append(f'monsters/{key}.json')
        all_curves += curves
        # 素材・剥ぎ取り
        mat_ids = [f'mat.{key}.{slug}' for slug, _, _ in spec['mats']]
        for (slug, name, price), mid_ in zip(spec['mats'], mat_ids):
            mats.append({'id': mid_, 'name': name})
            sells.append({'itemId': mid_, 'price': price})
        w4 = lambda ws: [{'itemId': mat_ids[i], 'weight': w} for i, w in enumerate(ws)]
        loot = {'id': f'loot.{key}', 'carve': {'count': 3, 'table': w4([40, 30, 18, 12])}, 'capture': {'count': 4, 'table': w4([35, 30, 20, 15])}, 'breaks': {}}
        part_ids = [p['id'] for p in mdef['parts']]
        for pid, idxs in spec['breaks'].items():
            assert pid in part_ids, (key, pid)
            loot['breaks'][pid] = {'count': 1, 'table': [{'itemId': mat_ids[i], 'weight': 60 if j == 0 else 40} for j, i in enumerate(idxs)]}
        loots.append(loot)
        qname, qsum = spec['quest']
        quests.append({
            'id': f'quest.{key}.r1', 'name': qname, 'kind': 'hunt', 'summary': qsum, 'mapId': 'map.basin.training', 'fieldId': 'field.basin',
            'targetMonsterId': f'monster.{key}', 'rankId': 'rank.1', 'monsterSpawn': {'x': 4, 'z': 15, 'yaw': 2.6}, 'timeLimitTicks': 54000, 'maxFaints': 3, 'returnTicks': 3600,
            'supplies': [{'itemId': 'item.heal_tonic', 'count': 5}, {'itemId': 'item.bind_trap', 'count': 1}, {'itemId': 'item.calm_orb', 'count': 3}, {'itemId': 'item.whetstone', 'count': 3}],
            'rewards': {'money': 600, 'items': [{'itemId': mat_ids[0], 'count': 1}]},
        })
        # 素材台帳
        manifest.append({'id': f'model.monster.{key}', 'name': spec['name'], 'type': 'model', 'use': f'大型モンスター（登録簿 {spec["no"]:02d}。v0.17.0 で遊べるようにした）', 'owner': 'ChatGPT（原画）→ Claude（仮モデル・動き）',
                         'status': 'concept', 'version': 0, 'path': None, 'source': f'原画 1 枚（art-source/monster/concepts/monster_{spec["no"]:02d}_{key}_concept_v2.png。採用待ち）を横から貼った仮の形。設定図（4 方向）・正式モデルは無い',
                         'terms': '本作オリジナル', 'dims': f'全長 約 {(max(p[0] for p in spec["plan"]["spine"]) - min(p[0] for p in spec["plan"]["spine"])) * s.s:.1f}m（登録簿の全長の約 0.68 倍）。Y 上・+Z 前',
                         'clips': clips, 'dependsOn': [f'tex.monster.{key}.side'],
                         'placeholder': {'kind': 'procedural', 'source': 'src/render/creatureRig.ts', 'note': f'形は src/render/creaturePlans.ts（tools/gen-monsters.py）。体つき {spec["frame"]}。骨の通った 1 枚の面に、原画を横から貼る。動きは型の組み合わせ（src/render/creatureMoves.ts）'},
                         'verification': 'ヘッドレス Chrome の画面で、形と原画の重なりと、技の動きを目で確かめた（11 種の並べた絵）。実機では未確認'})
        manifest.append({'id': f'tex.monster.{key}.side', 'name': f'{spec["name"]}の横から貼る絵', 'type': 'image', 'use': '仮モデルの体へ横から貼る色の絵', 'owner': 'Claude（原画から生成）', 'status': 'integrated', 'version': 1,
                         'path': f'assets/textures/monsters/{key}_side_v1.webp', 'source': f'art-source/monster/concepts/monster_{spec["no"]:02d}_{key}_concept_v2.png を tools/monster-art.py で加工（背景を抜き、体の外の色を近くの体の色で埋めた）',
                         'terms': '本作オリジナル（ChatGPT の原画からの二次加工。原画は採用待ち）', 'dims': '幅 1024px 以下の WebP'})
        states[f'monster.{key}'] = f'実装済み（v0.17.0。初級の依頼 1 件。技は登録簿の 4 つ。形は原画 1 枚から作った仮の形。狩場は風礫盆地を借りている）'
        plans.append(dict(key=key, frame=spec['frame'], scale=s.s, origin=[s.ox, s.gy], **{k: v for k, v in spec['plan'].items()}, moves=plan_moves))

    # 曲線・依頼・素材・剥ぎ取り
    write('public/data/curves_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種の技で進む距離（tools/gen-monsters.py の出力。手で編集しない）。keys は [tick, 累積距離 m]'}, 'curves', all_curves))
    write('public/data/quests_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種の依頼（tools/gen-monsters.py の出力。手で編集しない）。どれも初級で、最初から受けられる。狩場は風礫盆地を借りている（本来の狩場は登録簿の habitat）。報酬は机上の値'}, 'quests', quests))
    write('public/data/items_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種の素材（登録簿の素材の名前。tools/gen-monsters.py の出力。手で編集しない）', 'items': []}, 'materials', mats))
    write('public/data/loot_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種の剥ぎ取り・捕獲・部位破壊（tools/gen-monsters.py の出力。手で編集しない）。重みは机上の値'}, 'tables', loots))
    replace_rows('public/data/shop.json', 'sell', [f'mat.{spec["sp"].key}.' for spec in SPECIES], sells)
    update_content_index({'actions': actions_files, 'tracks': tracks_files, 'monsters': monster_files, 'curves': ['curves_creatures.json'], 'quests': ['quests_creatures.json'],
                          'items': ['items_creatures.json'], 'loot': ['loot_creatures.json']})
    update_manifest(manifest)
    update_bestiary(states)

    # 見た目の設計図
    out = ['// 生成物（npm run monsters:gen = tools/gen-monsters.py）。手で編集しない。型は src/render/creaturePlan.ts。',
           "import type { CreaturePlan } from './creaturePlan';", '',
           '/** モンスターの id → 仮モデルの設計図 */', 'export const CREATURE_PLANS: Record<string, CreaturePlan> = {']
    for p in plans:
        out.append(f"  'monster.{p['key']}': {json.dumps(p, ensure_ascii=False)},")
    out.append('};')
    write('src/render/creaturePlans.ts', '\n'.join(out) + '\n')
    print(f'{len(SPECIES)} 種: 技 {sum(len(sp["moves"](sp["sp"])) for sp in SPECIES)}、曲線 {len(all_curves)}、依頼 {len(quests)}、素材 {len(mats)}')


if __name__ == '__main__':
    main()
