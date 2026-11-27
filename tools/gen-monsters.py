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
  - 技と、技以外の動きは tools/monster_moves.py（v0.21.0。docs/decisions.md D-087・D-088）。大型は 18 前後（登録簿の 4 つ・咆哮・威嚇・退き・種に固有の技）、
    幼体は 7 前後。どの技も種ごとに固有の鍵の姿勢で動き、体の部位で当てる判定は、npm run monsters:bake が動きから軌道を作る（npm run monsters:gen が続けて走らせる）。
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


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from monster_lib import A, K, ai, both, hazard, hit, move, r3, track, unit  # noqa: E402
import monster_lib as ML  # noqa: E402
import monster_moves as MV  # noqa: E402
import design15 as D15  # noqa: E402

# ---- 上の級（中級〜極級。v0.34.0。D-116）----
# ChatGPT の全装備四級版（#15）の設計が、上の級の狩場を「風礫盆地」とした種（D15.RANK_SPECIES）だけ。素材の名前は設計のまま、
# 恒久 ID は「級 1 の同じ役の素材 + .r<級>」（tools/design15.py）。ほかの種は、設計の狩場ができてから（盆地で代わりにしない）
RANK_GATE = {2: 'quest.basin.003', 3: 'quest.basin.r2.001', 4: 'quest.basin.r3.001'}  # 級を開く依頼（ガルドロスの段の道と同じ）
RANK_MONEY = {2: 1100 / 600, 3: 1800 / 600, 4: 2800 / 600}  # 報酬の比（ガルドロスの段の報酬の比）
RANK_PRICE = {2: 3.5, 3: 7, 4: 14}  # 売値の比（ガルドロスの段の素材の比）
RANK_FIELD_TICKS = {2: 126000, 3: 144000, 4: 162000}  # 大型の依頼のフィールドの制限時間（ガルドロスと同じ 35 / 40 / 45 分）
# 依頼の名前とあらまし（掲示の話・依頼人・星・目安の時間は public/data/quest_board.json）。文は Claude が書いた
RANK_TEXT = {
    ('selvark', 2): ('張り詰めた帆角', '晶脈の新芽が育った盆地の段丘に、帆膜の厚いセルヴァルクが現れた。初級の個体より体力があり、一撃が重く、休む間も短い。横跳びの蹴りに気をつけて一頭を狩る。'),
    ('selvark', 3): ('風を裂く帆', '強い風の日に、帆角を大きく広げたセルヴァルクが荷道を何度も横切っている。跳ぶ前に片脚を畳む構えを見て、横へ抜ける。一頭を狩る。'),
    ('selvark', 4): ('盆地を渡る大帆', '帆膜が硬く育ちきったセルヴァルクが、盆地の風の通り道を縄張りにした。攻めの間隔が短い相手。大きな技を避けた後に攻める。一頭を狩る。'),
    ('kordopil', 2): ('固まり始めた子ら', '岩冠が固まり始めたコルドピルの群れが、補修したばかりの道を掘り返している。3 頭を討伐する。初級の群れより体が硬い。'),
    ('kordopil', 3): ('晶を帯びた子ら', '背に晶粒を帯びたコルドピルの群れが、運搬路の土を崩している。3 頭を討伐する。反撃も重いので、囲まれないように。'),
    ('kordopil', 4): ('親に並ぶ子ら', '親の岩殻に近いほど育ったコルドピルの群れが、里へ続く道のそばに居着いた。3 頭を討伐する。'),
    ('palseit', 2): ('跳ね回る小帆', '帆膜が張ってきたパルセイトの群れが、荷置き場を跳ね回っている。4 頭を討伐する。初級の群れより体力がある。'),
    ('palseit', 3): ('風に乗る小角', '風に乗って遠くまで跳ぶパルセイトの群れが、盆地の草地に広がった。4 頭を討伐する。止まる場所を見て、短い攻撃で。'),
    ('palseit', 4): ('群れで跳ぶ幼帆', '親に近い大きさのパルセイトの群れが、運搬路の脇に住みついた。4 頭を討伐する。'),
}


def round_to(v, step):
    return int(v / step + 0.5) * step


def rank_tables(key, loot, rmats):
    """級 1 の剥ぎ取り・捕獲・部位の表から、上の級の表を作る。同じ役の上の級の素材へ置き換え、
    役の無い素材（帆角軟骨・丸尾晶粒）は、その級の主の素材へ寄せる（重みは足す）"""
    out = []
    for r in D15.RANKS:
        mp = {m['baseId']: m['id'] for m in rmats if m['rank'] == r}
        main = next(m['id'] for m in rmats if m['rank'] == r and m['role'] == 'main')

        def conv(roll):
            t = {}
            for e in roll['table']:
                i = mp.get(e['itemId'], main)
                t[i] = t.get(i, 0) + e['weight']
            return {'count': roll['count'], 'table': [{'itemId': i, 'weight': w} for i, w in t.items()]}
        tb = {'id': f'loot.{key}.r{r}', 'carve': conv(loot['carve']), 'capture': conv(loot['capture']), 'breaks': {k: conv(v) for k, v in loot['breaks'].items()}}
        out.append(tb)
    return out


def rank_materials(key, base_prices):
    """上の級の素材（名前は設計のまま）と売値（級 1 の同じ役の素材の売値 × 比。5 で丸める）"""
    rm = D15.rank_materials(key)
    mats = [{'id': m['id'], 'name': m['name']} for m in rm]
    sells = [{'itemId': m['id'], 'price': round_to(base_prices[m['baseId']] * RANK_PRICE[m['rank']], 5)} for m in rm]
    return rm, mats, sells


class Sp:
    """1 種の座標の変換（原画の px → モンスターの座標 m）。"""

    def __init__(self, key, scale, origin):
        self.key, self.s, self.ox, self.gy = key, scale, origin[0], origin[1]

    def m(self, px, py, x=0.0):
        return [r3(x), r3((self.gy - py) * self.s), r3((px - self.ox) * self.s)]

    def L(self, px):
        return px * self.s


def part(pid, name, mat, hz, shapes, *, broken=None, elem=0.2, dur=None, flinch=(160, 60, 45, False), head=None):
    """部位。head: 気絶がたまる頭（v0.33.0）。省くと、id が head の部位"""
    p = {'id': pid, 'name': name, 'hitzone': {'cut': hz[0], 'blunt': hz[1], 'shot': hz[2]}}
    if broken:
        p['brokenHitzone'] = {'cut': broken[0], 'blunt': broken[1], 'shot': broken[2]}
    p['elementZone'] = elem
    p['breakDurability'] = dur
    p['material'] = mat
    if (pid == 'head') if head is None else head:
        p['head'] = True
    fl = {'threshold': flinch[0], 'growth': flinch[1], 'ticks': flinch[2]}
    if flinch[3]:
        fl['topple'] = True
    p['flinch'] = fl
    p['shapes'] = [{'a': a, 'b': b, 'r': r} if b is not None else {'a': a, 'r': r} for a, b, r in shapes]
    return p


# ---------------------------------------------------------------------------------------------
# 種ごとの定義（技と、技以外の動きは tools/monster_moves.py）
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
    moves=MV.selvark_moves, idle=MV.SELVARK_IDLE,
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
    moves=MV.numeradon_moves, idle=MV.NUMERADON_IDLE,
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
            dict(kind='blob', bone='own:sac0', own=dict(name='sac0', at=[680, 250], parent='spine:4'), c=[680, 205], r=[140, 140, 0.56], x=0.35, ch='sac', part='sac_l'),
            dict(kind='blob', bone='own:sac1', own=dict(name='sac1', at=[950, 300], parent='spine:5'), c=[950, 255], r=[165, 160, 0.64], x=-0.35, ch='sac', part='sac_r'),
            dict(kind='blob', bone='own:sac2', own=dict(name='sac2', at=[1130, 580], parent='spine:6'), c=[1150, 610], r=[140, 140, 0.56], ch='sac', part='sac_chest'),
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
    moves=MV.bornakel_moves, idle=MV.BORNAKEL_IDLE,
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
        part('crest', '頭の冠羽', 'hide', (0.8, 0.7, 0.75), [(s.m(1050, 110), s.m(1290, 160), 0.3)], broken=(0.9, 0.8, 0.85), dur=150, flinch=(120, 50, 45, False), head=True),
        part('tuft_l', '左の灰粉房', 'hide', (0.75, 0.7, 0.7), [(s.m(800, 520, 0.56), s.m(960, 520, 0.56), 0.28)], broken=(0.85, 0.8, 0.8), dur=170),
        part('tuft_r', '右の灰粉房', 'hide', (0.75, 0.7, 0.7), [(s.m(800, 520, -0.56), s.m(960, 520, -0.56), 0.28)], broken=(0.85, 0.8, 0.8), dur=170),
        part('tail', '尾羽', 'hide', (0.6, 0.5, 0.6), [(s.m(620, 480), s.m(150, 680), 0.28)], broken=(0.7, 0.6, 0.7), dur=160),
        part('body', '胴', 'hide', (0.5, 0.5, 0.45), [(s.m(680, 470), s.m(1060, 420), 0.7), (s.m(1080, 330), s.m(1100, 140), 0.2)]),
        part('legs', '脚', 'shell', (0.45, 0.5, 0.4), [(s.m(840, 640, 0.3), s.m(860, 930, 0.3), 0.15), (s.m(840, 640, -0.3), s.m(860, 930, -0.3), 0.15)], flinch=(190, 70, 120, True)),
    ],
    moves=MV.ashreia_moves, idle=MV.ASHREIA_IDLE,
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
    moves=MV.lumisca_moves, idle=MV.LUMISCA_IDLE,
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
    moves=MV.orglass_moves, idle=MV.ORGLASS_IDLE,
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
    moves=MV.tengaro_moves, idle=MV.TENGARO_IDLE,
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
    moves=MV.verito_moves, idle=MV.VERITO_IDLE,
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
    moves=MV.razmer_moves, idle=MV.RAZMER_IDLE,
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
            # ひれ足（v0.21.0）: 生態の「短い肢で這う」に合わせて、動かせる骨を持たせた（前 fin0・後ろ fin1。歩く周期で漕ぎ、fin で開く・畳む）。
            # 前のひれの下の縁は、地面の線（py 615）まで（原画の線のままだと、立っていても地面へ刺さる）
            dict(kind='sheet', bone='own:fin0', own=dict(name='fin0', at=[1130, 562], parent='spine:6'), mirror=True, x=0.35, tilt=0.9, thick=0.04, ch='fin',
                 pts=[[1100, 560], [1220, 565], [1150, 612], [1000, 618]]),
            dict(kind='sheet', bone='own:fin1', own=dict(name='fin1', at=[690, 542], parent='spine:4'), mirror=True, x=0.3, tilt=0.9, thick=0.04, ch='fin',
                 pts=[[650, 540], [760, 545], [700, 580], [620, 590]]),
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
    moves=MV.kirisave_moves, idle=MV.KIRISAVE_IDLE,
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
    moves=MV.velgait_moves, idle=MV.VELGAIT_IDLE,
    mats=[('mist_lamp', '霧灯晶', 45), ('tough_hide', '靭皮', 25), ('crown_shard', '環冠片', 50), ('mist_pore', '凝霧孔膜', 40)],
    breaks={'crown': [2], 'lamps_f': [0], 'lamps_b': [0, 3], 'tail': [1, 3]},
    quest=('霧灯の夜', '霧灯樹海の霧灯獣ヴェルガイトが、風礫盆地に迷い込んだ。頭冠の灯が灯ったら、遅れて霧の球が弾ける。'),
    route=dict(start='a9', roam=['a9', 'a6', 'a7'], nest='a10'),
))


# =============================================================================================
# 幼体 8 種（登録簿の 14〜21。v0.18.0、docs/spec.md の 23 章）
#   体: 親の原画の形を、尾を縮め・頭を大きく・飾りを小さくして、幼体の大きさ（登録簿の全長の 0.68 倍）にしたもの。
#       絵は親の原画をそのまま貼り、淡い色にする（幼体自身の原画案は v0.24.0 で受け取ったが、図鑑に出すだけで、形にはまだ使っていない）。
#   コルドピル（ガルドロスの幼体）だけは、ガルドロスの設定図（右側面）から形を書く。
#   技は登録簿の「構え→攻撃」3 つ。群れの決まり（herd）を持ち、捕獲はできない。
# =============================================================================================
import copy

JUV_RATIO = 0.68


class Juv:
    """幼体の座標: 親の原画の px を、尾を縮めて（と、輪の体は低くして）から、幼体の大きさの m へ。"""

    def __init__(self, key, art, psp, pplan, size, *, tail_k=0.7, squash=1.0, head=1.25, neck=1.1, belly=1.0, legs_r=1.0, extra_k=0.55, eye_k=1.3,
                 drop=None, add_legs=(), add_extras=(), tint=(1.12, 1.1, 1.06), pale=0.1):
        self.key, self.art, self.psp = key, art, psp
        roles = pplan['roles']
        ib = next(i for i, c in enumerate(roles) if c in 'ba')
        self.b0 = pplan['spine'][ib][:2]
        self.tail_k, self.squash, self.gy = tail_k, squash, psp.gy
        xs = [self.tx(p[0], p[1])[0] for p in pplan['spine']]
        self.span = max(xs) - min(xs)
        self.s = size * JUV_RATIO / self.span
        self.ratio = self.s / psp.s
        self.ox = round(self.tx(*pplan['spine'][pplan['root']][:2])[0])
        self.plan = self._plan(pplan, head, neck, belly, legs_r, extra_k, eye_k, drop or (lambda e, k: False), add_legs, add_extras)
        self.plan['look'] = {'tint': [r3(c) for c in tint], 'pale': pale}

    def tx(self, px, py):
        bx, by = self.b0
        if px < bx and self.tail_k != 1:
            px, py = bx + (px - bx) * self.tail_k, by + (py - by) * self.tail_k
        if self.squash != 1:
            py = self.gy - (self.gy - py) * self.squash
        return px, py

    def m(self, px, py, x=0.0):
        """親の原画の px と、親の大きさの横の位置 x (m) → 幼体の座標 [x, y, z] (m)"""
        tx_, ty_ = self.tx(px, py)
        return [r3(x * self.ratio), r3((self.gy - ty_) * self.s), r3((tx_ - self.ox) * self.s)]

    def L(self, meters_parent):
        return r3(meters_parent * self.ratio)

    def spine_m(self, i):
        """幼体の背骨の点 i の中心 [x, y, z] (m)"""
        p = self.plan['spine'][i]
        return [0.0, r3((self.gy - p[1]) * self.s), r3((p[0] - self.ox) * self.s)]

    def _plan(self, P, head, neck, belly, legs_r, extra_k, eye_k, drop, add_legs, add_extras):
        p = copy.deepcopy({k: v for k, v in P.items() if k != 'moves'})
        roles = p['roles']
        ih = roles.rindex('h') if 'h' in roles else len(roles) - 2
        spine = []
        for i, q in enumerate(p['spine']):
            x, y = self.tx(q[0], q[1])
            k = head if i >= ih else neck if roles[i] == 'n' else 1.0
            dn = belly if roles[i] == 'b' else 1.0
            spine.append([round(x), round(y), round(q[2] * k), round(q[3] * k * dn), round(q[4] * k)])
        p['spine'] = spine
        if 'profile' in p:
            # 原画に合わせた太さの並びも、頭・首・腹の倍率を掛ける（区間の役は、区間の始めの点の役）
            prof = []
            for at, t, b, sd in p['profile']:
                i = min(len(roles) - 1, int(math.floor(at)))
                k = head if i >= ih else neck if roles[i] == 'n' else 1.0
                dn = belly if roles[i] == 'b' else 1.0
                prof.append([at, round(t * k, 1), round(b * k * dn, 1), round(sd * k, 1)])
            p['profile'] = prof
        legs = []
        for L in [copy.deepcopy(l) for l in p['legs']] + [copy.deepcopy(l) for l in add_legs]:
            L['pts'] = [[*[round(v) for v in self.tx(a, b)], r3(xm * self.ratio)] for a, b, xm in L['pts']]
            L['r'] = [round(r * legs_r) for r in L['r']]
            if 'prof' in L:
                L['prof'] = [[at, round(r * legs_r, 1)] for at, r in L['prof']]
            legs.append(L)
        p['legs'] = legs
        sp_xy = [(q[0], q[1]) for q in spine]
        extras = []
        # drop(e, k): k = 同じ部位（part）の中で何番目か。写した後の物を選ぶので、番号で選ぶ（v0.21.0。写す前の物の id() で
        # 選んでいたので、チルミカナの燐節とユルテピカの紡糸管が、残すはずの物まで全部落ちていた）
        seen = {}
        for e0 in list(p['extras']) + [copy.deepcopy(e) for e in add_extras]:
            k_part = seen.get(e0.get('part'), 0)
            seen[e0.get('part')] = k_part + 1
            if drop(e0, k_part):
                continue
            e = copy.deepcopy(e0)
            k = e.pop('jk', None)
            eye = e['kind'] == 'blob' and e.get('shade', 1) <= 0.3 and e['r'][0] <= 30
            if k is None:
                k = eye_k if eye else extra_k
            T = lambda q: self.tx(q[0], q[1])
            if 'own' in e:
                e['own'] = dict(e['own'])
                e['own']['at'] = [round(v) for v in T(e['own']['at'])]
            # 支点: 目・体に沿った物は自分の中心、own の骨は付け根、円すいは根元、ほかは近い背骨の点
            if eye or e.get('bone') == 'chain':
                pv = T(e['c'])
            elif 'own' in e:
                pv = e['own']['at']
            elif e['kind'] in ('cone', 'funnel'):
                pv = T(e['a'])
            else:
                c = e['c'] if 'c' in e else [sum(q[0] for q in e['pts']) / len(e['pts']), sum(q[1] for q in e['pts']) / len(e['pts'])]
                cc = T(c)
                pv = min(sp_xy, key=lambda q: (q[0] - cc[0]) ** 2 + (q[1] - cc[1]) ** 2)
            S = lambda q: [round(pv[0] + (T(q)[0] - pv[0]) * k), round(pv[1] + (T(q)[1] - pv[1]) * k)]
            if 'c' in e:
                e['c'] = S(e['c'])
            if 'pts' in e:
                e['pts'] = [S(q) for q in e['pts']]
            if 'a' in e:
                e['a'] = S(e['a'])
            if 'b' in e:
                e['b'] = S(e['b'])
            if e['kind'] == 'blob':
                e['r'] = [round(e['r'][0] * k), round(e['r'][1] * k), r3(e['r'][2] * self.ratio * k)]
            for key in ('ra', 'rb', 'ring', 'tube'):
                if key in e:
                    e[key] = max(2, round(e[key] * k))
            for key in ('x', 'thick', 'bx'):
                if key in e:
                    e[key] = r3(e[key] * self.ratio)
            extras.append(e)
        p['extras'] = extras
        p['stride'] = r3(p['stride'] * self.ratio * 1.15)
        p['lift'] = r3(p['lift'] * self.ratio * 1.2)
        p['key'] = self.art
        p['scale'] = self.s
        p['origin'] = [self.ox, self.gy]
        return p


def skin_entry(key, name, source, terms):
    """肌の細かな模様の絵（v0.21.0。tools/monster-art.py の出力）の素材台帳の行"""
    return {'id': f'tex.monster.{key}.skin', 'name': f'{name}の肌の細かな模様', 'type': 'image', 'use': '仮モデルの、横から貼る絵が伸びる面（前・後ろ・上・下）に重ねる模様（細かな濃淡の倍率）',
            'owner': 'Claude（原画から生成）', 'status': 'integrated', 'version': 1, 'path': f'assets/textures/monsters/{key}_skin_v1.webp',
            'source': f'{source} の体の奥の正方形を tools/monster-art.py で加工（ゆるい濃淡を除き、端をつないだ。平均 0.5 = 倍率 1）', 'terms': terms, 'dims': '256 × 256 の WebP'}


def jpart(pid, name, mat, hz, shapes, *, dur=None, flinch=(45, 25, 40, False), head=None):
    """幼体の部位: 怯みやすく、柔らかい。破壊できる部位は、壊すと少し長く怯む（素材は出ない）。"""
    return part(pid, name, mat, hz, shapes, dur=dur, broken=tuple(r3(min(1.0, v + 0.1)) for v in hz) if dur else None, elem=0.25, flinch=flinch, head=head)


def herd(size, spacing, alert, flee, speed, run, fight, fticks, scatter=False):
    return {'size': list(size), 'spacing': spacing, 'alertRange': alert, 'fleeRange': flee, 'fleeSpeedScale': speed, 'fleeTicks': run,
            'fightChance': fight, 'fightTicks': list(fticks), 'scatter': scatter}


BY_KEY = {spec['sp'].key: spec for spec in SPECIES}


# ---- 原画の輪郭に合わせる（v0.21.0。docs/spec.md の 22.4）----
# 体の太さ（背骨の点の半径）は、手で書いた 13 点ほどの値の間を、なめらかにつないでいた。
# 原画の輪郭（背景と違う所）を、背骨に沿って細かく（区間ごとに PROFILE_N 点）測り、太さの並び（profile）にする。
# 脚も、脚の線に沿って、輪郭の幅を測る（prof）。脚・翼・角膜などの付き物は、測る前に輪郭から除く。
# 測った値は、手で書いた値の FIT_LO〜FIT_HI 倍の間に収める（脚の付け根などで、輪郭が地面まで続くのを防ぐ）。
PROFILE_N = 10
FIT_LO, FIT_HI = 0.55, 1.6


def art_path(key):
    if key == 'galdros':
        return os.path.join(ROOT, 'art-source', 'monster', 'galdros', 'galdros_right_v1.png')
    d = os.path.join(ROOT, 'art-source', 'monster', 'concepts')
    return os.path.join(d, next(f for f in os.listdir(d) if f.endswith('.png') and f'_{key}_' in f))


def art_mask(key):
    """原画の、背景と違う所（穴は埋める）"""
    from PIL import Image
    import numpy as np
    from scipy import ndimage
    rgb = np.asarray(Image.open(art_path(key)).convert('RGB')).astype(np.float32)
    border = np.concatenate([rgb[:16].reshape(-1, 3), rgb[-16:].reshape(-1, 3), rgb[:, :16].reshape(-1, 3), rgb[:, -16:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    fg = ndimage.binary_opening(np.abs(rgb - bg).max(axis=2) > 22, iterations=2)
    lab, n = ndimage.label(fg)
    if n == 0:
        return fg
    area = ndimage.sum(fg, lab, index=range(1, n + 1))
    keep = [0] + [1 if a >= max(area) * 0.02 else 0 for a in area]
    import numpy as np2
    fg = np2.array(keep, dtype=bool)[lab]
    return ndimage.binary_fill_holes(fg)


def catmull_px(pts, at):
    i = min(len(pts) - 2, max(0, int(math.floor(at))))
    t = at - i
    p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
    t2, t3 = t * t, t * t * t
    f = lambda a, b, c, d: 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
    return (f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]))


def ray_len(mask, x, y, dx, dy, max_len):
    """(x, y) から (dx, dy) の向きへ、輪郭の外へ出るまでの長さ（px）。始めから外なら 0"""
    h, w = mask.shape
    n = math.hypot(dx, dy) or 1
    dx, dy = dx / n, dy / n
    L = 0.0
    while L < max_len:
        xi, yi = int(round(x + dx * L)), int(round(y + dy * L))
        if xi < 0 or yi < 0 or xi >= w or yi >= h or not mask[yi, xi]:
            return L
        L += 1.0
    return max_len


def exclusion(shape, plan, spec_scale):
    """測る前に、輪郭から除く物（脚・付き物）の形"""
    import numpy as np
    from PIL import Image, ImageDraw
    h, w = shape
    im = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im)
    for e in plan['extras']:
        if e['kind'] == 'sheet':
            d.polygon([tuple(q) for q in e['pts']], fill=255)
        elif e['kind'] == 'blob' and e.get('shade', 1) > 0.3:
            cx, cy = e['c']
            rx, ry = e['r'][0], e['r'][1]
            d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
        elif e['kind'] in ('cone', 'funnel'):
            (ax, ay), (bx, by) = e['a'], e['b']
            ra, rb = e.get('ra', 10), e.get('rb', 2)
            nx, ny = -(by - ay), bx - ax
            nn = math.hypot(nx, ny) or 1
            nx, ny = nx / nn, ny / nn
            d.polygon([(ax + nx * ra, ay + ny * ra), (bx + nx * rb, by + ny * rb), (bx - nx * rb, by - ny * rb), (ax - nx * ra, ay - ny * ra)], fill=255)
        elif e['kind'] == 'torus':
            cx, cy = e['c']
            R = e.get('ring', 100) + e.get('tube', 12)
            d.ellipse([cx - R * 0.35, cy - R, cx + R * 0.35, cy + R], fill=255)
    return np.asarray(im) > 0


def smooth_list(vals, k=2):
    out = []
    for i in range(len(vals)):
        win = sorted(vals[max(0, i - k):i + k + 1])
        out.append(win[len(win) // 2])
    # 軽くならす
    res = []
    for i in range(len(out)):
        a, b, c = out[max(0, i - 1)], out[i], out[min(len(out) - 1, i + 1)]
        res.append((a + 2 * b + c) / 4)
    return res


def fit_profile(key, plan):
    """背骨に沿った太さの並び [at, 上, 下, 横]（px）と、脚ごとの太さの並び [at, 半径]（px）"""
    mask = art_mask(key)
    body = mask & ~exclusion(mask.shape, plan, 1)
    spine = plan['spine']
    pts = [(q[0], q[1]) for q in spine]
    N = len(pts)
    prof = []
    tops, bots = [], []
    ats = [i + k / PROFILE_N for i in range(N - 1) for k in range(PROFILE_N)] + [N - 1.0]
    for at in ats:
        x, y = catmull_px(pts, at)
        x1, y1 = catmull_px(pts, min(N - 1.0, at + 0.05))
        x0, y0 = catmull_px(pts, max(0.0, at - 0.05))
        tx, ty = x1 - x0, y1 - y0
        i = min(N - 2, int(math.floor(at)))
        f = at - i
        top0 = spine[i][2] + (spine[i + 1][2] - spine[i][2]) * f
        bot0 = spine[i][3] + (spine[i + 1][3] - spine[i][3]) * f
        # 上 = 進む向きの左（画面で上）、下 = 右
        t = ray_len(body, x, y, ty, -tx, top0 * FIT_HI + 2)
        b = ray_len(body, x, y, -ty, tx, bot0 * FIT_HI + 2)
        tops.append(min(max(t, top0 * FIT_LO), top0 * FIT_HI))
        bots.append(min(max(b, bot0 * FIT_LO), bot0 * FIT_HI))
    tops, bots = smooth_list(tops), smooth_list(bots)
    for at, t, b in zip(ats, tops, bots):
        i = min(N - 2, int(math.floor(at)))
        f = at - i
        top0 = spine[i][2] + (spine[i + 1][2] - spine[i][2]) * f
        bot0 = spine[i][3] + (spine[i + 1][3] - spine[i][3]) * f
        side0 = spine[i][4] + (spine[i + 1][4] - spine[i][4]) * f
        # 横の太さは、測れないので、手で書いた横と縦の比を保って、縦の太さに合わせる
        side = side0 * ((t + b) / max(1e-6, top0 + bot0))
        prof.append([round(at, 3), round(t, 1), round(b, 1), round(side, 1)])
    legs = []
    for L in plan['legs']:
        lp = [(q[0], q[1]) for q in L['pts']]
        n = len(lp)
        out = []
        for at in [i + k / 6 for i in range(n - 1) for k in range(6)] + [n - 1.0]:
            x, y = catmull_px(lp, at)
            x1, y1 = catmull_px(lp, min(n - 1.0, at + 0.05))
            x0, y0 = catmull_px(lp, max(0.0, at - 0.05))
            tx, ty = x1 - x0, y1 - y0
            i = min(n - 2, int(math.floor(at)))
            f = at - i
            r0 = L['r'][i] + (L['r'][i + 1] - L['r'][i]) * f
            wl = ray_len(mask, x, y, ty, -tx, r0 * FIT_HI + 2)
            wr = ray_len(mask, x, y, -ty, tx, r0 * FIT_HI + 2)
            r = (wl + wr) / 2
            # 付け根から最初の関節までは、体の輪郭と重なるので、手で書いた太さを超えない（体の中に隠れる太さ）
            hi = 1.0 if at < 1.0 else 1.3
            out.append([round(at, 3), min(max(r, r0 * FIT_LO), r0 * hi)])
        sm = smooth_list([q[1] for q in out], 1)
        legs.append([[q[0], round(v, 1)] for q, v in zip(out, sm)])
    return prof, legs


def seat_blobs(plan):
    """背中の粒（灯・晶の粒など、背骨に付いた小さな塊）を、測った体の面に半分ほど埋める（体が細くなって、浮かないように）"""
    spine = plan['spine']
    pts = [(q[0], q[1]) for q in spine]
    prof = plan['profile']
    for e in plan['extras']:
        if e['kind'] != 'blob' or e.get('shade', 1) <= 0.3 or not (e['bone'] == 'chain' or e['bone'].startswith('spine:')) or e.get('mirror'):
            continue
        cx, cy = e['c']
        ry = e['r'][1]
        # いちばん近い背骨の位置と、そこでの体の上の面
        best = min(prof, key=lambda q: (catmull_px(pts, q[0])[0] - cx) ** 2 + (catmull_px(pts, q[0])[1] - cy) ** 2)
        sx, sy = catmull_px(pts, best[0])
        top_y = sy - best[1]
        # 体より上にある粒だけ（体の中の粒は、そのまま）
        if cy < top_y and cy + ry * 0.45 < top_y:
            e['c'] = [cx, round(top_y - ry * 0.45)]


# 足先の指（v0.21.0）: 原画の足の形から。hoof = 割れた蹄、toe = 丸い指と爪、talon = 鳥の足と鉤爪。足先の塊（foot）のある脚だけ
TOES = {
    'selvark': dict(kind='hoof', n=2, len=0.0, claw=0.0),
    'numeradon': dict(kind='toe', n=4, len=0.5, claw=0.22),
    'bornakel': dict(kind='toe', n=4, len=0.42, claw=0.14),
    'ashreia': dict(kind='talon', n=3, len=0.95, claw=0.38),
    'lumisca': dict(kind='talon', n=3, len=0.95, claw=0.38),
    'razmer': dict(kind='toe', n=5, len=0.62, claw=0.36),
    'velgait': dict(kind='toe', n=4, len=0.42, claw=0.26),
    'galdros': dict(kind='toe', n=3, len=0.45, claw=0.32),
}


def add_toes(key, plan):
    t = TOES.get(key)
    if not t:
        return
    for L in plan['legs']:
        if L.get('foot') and L['group'] not in ('clawR', 'clawL'):
            L['toes'] = dict(t)


for spec in SPECIES:
    prof, legs = fit_profile(spec['sp'].key, spec['plan'])
    spec['plan']['profile'] = prof
    for L, lp in zip(spec['plan']['legs'], legs):
        L['prof'] = lp
    seat_blobs(spec['plan'])
    add_toes(spec['sp'].key, spec['plan'])

# ガルドロス（成体）の形を、設定図の右側面（art-source/monster/galdros/galdros_right_v1.png。1672×941、地面 y=790）の px で書く。
# 遊べるガルドロスは専用の仮モデル（src/render/galdrosRig.ts）なので、この形は幼体コルドピルの元にだけ使う。
GALDROS_SP = Sp('galdros', 0.003693, (930, 790))
GALDROS_PLAN = dict(
    spine=[[50, 625, 30, 30, 34], [170, 600, 62, 60, 66], [300, 575, 52, 50, 56], [430, 545, 70, 70, 75], [560, 500, 150, 120, 170], [740, 450, 260, 160, 300],
           [930, 430, 290, 180, 320], [1110, 430, 270, 170, 300], [1270, 410, 170, 120, 170], [1370, 370, 120, 100, 110], [1470, 330, 120, 115, 110],
           [1570, 345, 75, 70, 70], [1615, 365, 25, 25, 28]],
    roles='-tttbbbbnnh--', root=6,
    legs=[
        dict(group='F', attach=7, pts=[[1150, 520, 1.0], [1200, 640, 1.05], [1250, 735, 1.08], [1270, 785, 1.1]], r=[130, 95, 80, 70], mirror=True, phase=0.0, foot=[180, 50]),
        dict(group='H', attach=5, pts=[[700, 530, 1.0], [650, 640, 1.05], [640, 735, 1.08], [650, 785, 1.1]], r=[150, 100, 85, 72], mirror=True, phase=0.5, foot=[190, 50]),
    ],
    extras=[
        dict(kind='blob', bone='spine:10', c=[1440, 222], r=[120, 28, 0.42], part='crown', jk=0.5),
        dict(kind='blob', bone='spine:1', c=[160, 600], r=[110, 72, 0.3], part='tail_tip', jk=0.45),
        dict(kind='blob', bone='spine:10', c=[1500, 322], r=[12, 10, 0.035], mirror=True, x=0.33, shade=0.25),
    ],
    stride=1.6, lift=0.2,
)

_gp, _gl = fit_profile('galdros', GALDROS_PLAN)
GALDROS_PLAN['profile'] = _gp
for _L, _lp in zip(GALDROS_PLAN['legs'], _gl):
    _L['prof'] = _lp
add_toes('galdros', GALDROS_PLAN)

JUVENILES = []

# ---- 14 コルドピル（ガルドロスの幼体。四足重獣）----
J = Juv('kordopil', 'galdros', GALDROS_SP, GALDROS_PLAN, 3.2, tail_k=0.5, head=1.3, belly=1.12, legs_r=1.08, eye_k=1.5,
        add_extras=[dict(kind='sheet', bone='spine:6', x=0.62, tilt=0.5, thick=0.07, part='plate', jk=0.85,
                         pts=[[790, 300], [880, 205], [1050, 190], [1130, 250], [1090, 330], [880, 340]])],
        tint=(1.1, 1.08, 1.04), pale=0.12)
JUVENILES.append(dict(
    J=J, no=14, name='岩殻獣の幼体 コルドピル', parent='galdros', frame='quad', rig='quadruped_heavy',
    stats=dict(hp=260, bodyRadius=0.55, turn=150, moveSpeed=2.4, approach=(1.4, 60), collision=[(0.0, 0.55)], cooldown=(40, 80)),
    herd=herd((3, 5), 2.4, 20, 10, 1.75, 420, 0.35, (240, 420)),
    parts=lambda J: [
        jpart('crown', '薄い頭冠', 'rock', (0.7, 0.85, 0.65), [(J.m(1380, 250), J.m(1520, 240), 0.3)], dur=60),
        jpart('plate', '左背の幼岩板', 'rock', (0.55, 0.7, 0.5), [(J.m(820, 230, 0.6), J.m(1100, 240, 0.6), 0.34)], dur=80),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1380, 360), J.m(1610, 360), 0.3)], flinch=(35, 20, 40, False)),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(560, 470), J.m(1200, 420), 0.5)]),
        jpart('legs', '脚', 'hide', (0.7, 0.7, 0.65), [(J.m(1150, 560, 1.0), J.m(1260, 770, 1.1), 0.16), (J.m(1150, 560, -1.0), J.m(1260, 770, -1.1), 0.16),
                                                     (J.m(690, 560, 1.0), J.m(650, 770, 1.1), 0.17), (J.m(690, 560, -1.0), J.m(650, 770, -1.1), 0.17)], flinch=(60, 30, 90, True)),
    ],
    moves=MV.kordopil_moves, idle=MV.KORDOPIL_IDLE,
    mats=[('juv_shell', '幼岩殻片', 12), ('soft_bed', '柔らかい晶床', 18), ('tail_grain', '丸尾晶粒', 22)],
    quest=('岩殻の子ら', 3, '風礫盆地の草の斜面を、ガルドロスの幼体コルドピルの群れが掘り返している。増えすぎた群れから 3 頭を間引く。外側の個体から先に逃げる。'),
))

# ---- 15 パルセイト（セルヴァルクの幼体。四足軽獣）----
P_ = BY_KEY['selvark']
J = Juv('palseit', 'selvark', P_['sp'], P_['plan'], 2.4, tail_k=0.6, head=1.35, legs_r=0.9, extra_k=0.4, eye_k=1.6, tint=(1.12, 1.1, 1.06))
JUVENILES.append(dict(
    J=J, no=15, name='帆角獣の幼体 パルセイト', parent='selvark', frame='quad', rig='quadruped_light',
    stats=dict(hp=170, bodyRadius=0.4, turn=200, moveSpeed=3.4, approach=(1.3, 60), collision=[(0.0, 0.4)], cooldown=(35, 70)),
    herd=herd((4, 6), 2.0, 24, 13, 1.5, 360, 0.15, (180, 300)),
    parts=lambda J: [
        jpart('crest_l', '左の幼角膜', 'hide', (0.8, 0.75, 0.8), [(J.m(1150, 330, 0.3), J.m(900, 360, 0.4), 0.22)], dur=40),
        jpart('crest_r', '右の幼角膜', 'hide', (0.8, 0.75, 0.8), [(J.m(1150, 330, -0.3), J.m(900, 360, -0.4), 0.22)], dur=40),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1190, 320), J.m(1305, 352), 0.24)], flinch=(30, 18, 40, False)),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(600, 525), J.m(1090, 480), 0.36)]),
        jpart('legs', '脚', 'hide', (0.7, 0.7, 0.65), [(J.m(1050, 610, 0.3), J.m(1150, 925, 0.3), 0.14), (J.m(1050, 610, -0.3), J.m(1150, 925, -0.3), 0.14),
                                                     (J.m(600, 600, 0.3), J.m(600, 925, 0.3), 0.15), (J.m(600, 600, -0.3), J.m(600, 925, -0.3), 0.15)], flinch=(50, 25, 80, True)),
    ],
    moves=MV.palseit_moves, idle=MV.PALSEIT_IDLE,
    mats=[('juv_membrane', '幼帆膜', 12), ('thin_tendon', '細弾性腱', 18)],
    quest=('跳ねる小角', 4, 'セルヴァルクの幼体パルセイトの小群が、盆地の草地を跳ね回っている。4 頭を討伐する。危険を見つけた個体から跳ねて逃げるので、壁際へ追い込む。'),
))

# ---- 16 ヌマポロン（ヌメラドンの幼体。四足重獣）----
P_ = BY_KEY['numeradon']
J = Juv('numaporon', 'numeradon', P_['sp'], P_['plan'], 3.0, tail_k=0.65, head=1.3, belly=1.1, legs_r=0.95, extra_k=0.5, eye_k=1.5,
        drop=lambda e, k: e.get('part') == 'sacs', tint=(1.12, 1.1, 1.08))
JUVENILES.append(dict(
    J=J, no=16, name='泥冠獣の幼体 ヌマポロン', parent='numeradon', frame='quad', rig='quadruped_heavy',
    stats=dict(hp=240, bodyRadius=0.55, turn=130, moveSpeed=2.2, approach=(1.5, 60), collision=[(0.0, 0.55)], cooldown=(45, 85)),
    herd=herd((3, 6), 2.4, 16, 8, 1.6, 480, 0.5, (300, 480)),
    parts=lambda J: [
        jpart('dish', '薄い泥皿', 'rock', (0.7, 0.85, 0.65), [(J.m(1000, 300), J.m(1400, 300), 0.3)], dur=60),
        jpart('fin', '尾の幼ひれ', 'hide', (0.85, 0.8, 0.8), [(J.m(330, 560), J.m(60, 700), 0.24)], dur=40),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1250, 440), J.m(1490, 430), 0.3)], flinch=(35, 20, 40, False)),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(400, 500), J.m(1100, 450), 0.5)]),
        jpart('legs', '脚', 'hide', (0.7, 0.7, 0.65), [(J.m(1000, 660, 1.05), J.m(1010, 850, 1.05), 0.2), (J.m(1000, 660, -1.05), J.m(1010, 850, -1.05), 0.2),
                                                     (J.m(380, 660, 1.05), J.m(385, 840, 1.05), 0.2), (J.m(380, 660, -1.05), J.m(385, 840, -1.05), 0.2)], flinch=(60, 30, 90, True)),
    ],
    moves=MV.numaporon_moves, idle=MV.NUMAPORON_IDLE,
    mats=[('juv_mud_crystal', '幼泥晶', 12), ('thin_hide', '薄耐水皮', 16), ('juv_crown', '幼冠甲', 22)],
    quest=('泥皿の子', 3, 'ヌメラドンの幼体ヌマポロンの群れが、盆地の水場を泥で埋めている。3 頭を討伐する。小粒の泥吐きと、短い腹滑りに注意。'),
))

# ---- 17 チルミカナ（ルミスカの幼体。二足翼獣）----
P_ = BY_KEY['lumisca']
J = Juv('chilumicana', 'lumisca', P_['sp'], P_['plan'], 2.5, tail_k=0.5, head=1.35, extra_k=0.6, eye_k=1.6,
        drop=lambda e, k: e.get('part') == 'nodes' and k not in (1, 3), tint=(1.14, 1.12, 1.08), pale=0.12)
JUVENILES.append(dict(
    J=J, no=17, name='燐尾鳥の幼体 チルミカナ', parent='lumisca', frame='biped', rig='biped_wing',
    stats=dict(hp=170, bodyRadius=0.4, turn=180, moveSpeed=3.0, approach=(1.3, 60), collision=[(0.0, 0.4)], cooldown=(35, 75)),
    herd=herd((3, 5), 2.0, 22, 12, 1.6, 360, 0.2, (180, 300)),
    parts=lambda J: [
        jpart('nodes', '尾の幼燐節', 'shell', (0.8, 0.75, 0.85), [(J.m(700, 420), J.m(200, 520), 0.24)], dur=40),
        jpart('wing', '翼端の薄甲', 'shell', (0.8, 0.75, 0.85), [(J.m(1200, 330, 0.55), J.m(900, 480, 0.6), 0.22), (J.m(1200, 330, -0.55), J.m(900, 480, -0.6), 0.22)], dur=40),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1380, 220), J.m(1480, 250), 0.24)], flinch=(30, 18, 40, False)),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(900, 400), J.m(1330, 380), 0.36)]),
        jpart('legs', '脚', 'shell', (0.7, 0.7, 0.65), [(J.m(1100, 580, 0.3), J.m(1150, 890, 0.3), 0.14), (J.m(1100, 580, -0.3), J.m(1150, 890, -0.3), 0.14)], flinch=(50, 25, 80, True)),
    ],
    moves=MV.chilumicana_moves, idle=MV.CHILUMICANA_IDLE,
    mats=[('juv_node', '幼燐節', 14), ('pale_hide', '淡光皮', 12), ('small_film', '小放電膜', 20)],
    quest=('灯る尾の子', 3, 'ルミスカの幼体チルミカナの群れが、盆地の礫原で尾を光らせている。3 羽を討伐する。追われると、翼で低く滑ってから走る。'),
))

# ---- 18 コハルギス（オルグラスの幼体。六脚甲殻）----
P_ = BY_KEY['orglass']
_small_claw_r = [
    dict(kind='blob', bone='leg:clawR:2', c=[1320, 345], r=[85, 65, 0.2], x=-0.75, part='claw', jk=1.0),
    dict(kind='cone', bone='own:finger_R', own=dict(name='finger_R', at=[1360, 320], parent='leg:clawR:2'), a=[1360, 320], b=[1470, 295], ra=30, rb=5, x=-0.75, ch='finger', jk=1.0),
]
J = Juv('kohalgis', 'orglass', P_['sp'], P_['plan'], 2.6, tail_k=1.0, head=1.25, legs_r=1.0, extra_k=0.75, eye_k=1.4,
        drop=lambda e, k: (e['kind'] == 'sheet' and e.get('part') == 'plates') or e.get('part') == 'claw_r' or (e.get('ch') == 'finger' and e.get('x', 0) < 0),
        add_extras=_small_claw_r, tint=(1.16, 1.15, 1.12), pale=0.16)
# 右の鋏の腕を、左と同じ小鋏の長さに
for L in J.plan['legs']:
    if L['group'] == 'clawR':
        L['pts'] = [[1000, 430, -0.34], [1150, 400, -0.48], [1250, 380, -0.51]]
        L['r'] = [35, 32, 30]
        L['pts'] = [[*[round(v) for v in J.tx(a, b)], xm] for a, b, xm in L['pts']]
        L['attach'] = 5
JUVENILES.append(dict(
    J=J, no=18, name='硝殻蟹の幼体 コハルギス', parent='orglass', frame='crab', rig='crust_six',
    stats=dict(hp=200, bodyRadius=0.5, turn=170, moveSpeed=2.8, approach=(1.3, 60), collision=[(0.0, 0.5)], cooldown=(40, 80)),
    herd=herd((4, 7), 1.9, 18, 9, 1.7, 300, 0.3, (240, 360), scatter=True),
    parts=lambda J: [
        jpart('shell', '乳白の背殻', 'shell', (0.55, 0.65, 0.5), [(J.m(200, 360), J.m(950, 320), 0.36)], dur=70),
        jpart('claw', '右の幼鋏', 'shell', (0.7, 0.75, 0.7), [(J.m(1150, 400, -0.7), J.m(1420, 320, -0.75), 0.18), (J.m(1150, 400, 0.7), J.m(1420, 320, 0.75), 0.18)], dur=40),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1000, 410), J.m(1120, 400), 0.22)], flinch=(30, 18, 40, False)),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(250, 520), J.m(950, 480), 0.36)]),
        jpart('legs', '脚', 'shell', (0.7, 0.7, 0.65), [(J.m(560, 600, 1.35), J.m(410, 940, 1.7), 0.14), (J.m(560, 600, -1.35), J.m(410, 940, -1.7), 0.14),
                                                       (J.m(760, 600, 1.25), J.m(840, 940, 1.6), 0.14), (J.m(760, 600, -1.25), J.m(840, 940, -1.6), 0.14)], flinch=(60, 30, 90, True)),
    ],
    moves=MV.kohalgis_moves, idle=MV.KOHALGIS_IDLE,
    mats=[('juv_glass', '幼硝殻', 12), ('small_claw', '小鋏芯', 18), ('thin_gland', '成形腺の薄膜', 24)],
    quest=('乳白の殻', 4, 'オルグラスの幼体コハルギスが、盆地の岩の割れ目に集まっている。4 体を討伐する。逃げる時は、ばらばらの割れ目へ散る。'),
))

# ---- 19 ミトガロン（テンガロの幼体。輪の虫）----
P_ = BY_KEY['tengaro']
J = Juv('mitogaron', 'tengaro', P_['sp'], P_['plan'], 3.8, tail_k=1.0, squash=0.72, head=1.25, extra_k=0.5, eye_k=1.5, tint=(1.12, 1.1, 1.08))
JUVENILES.append(dict(
    J=J, no=19, name='鉤輪蟲の幼体 ミトガロン', parent='tengaro', frame='arch', rig='crust_many',
    stats=dict(hp=280, bodyRadius=0.5, turn=110, moveSpeed=2.0, approach=(1.5, 60), collision=[(0.75, 0.42), (-0.75, 0.42)], cooldown=(45, 90)),
    herd=herd((3, 6), 2.6, 16, 8, 1.8, 480, 0.45, (300, 480)),
    parts=lambda J: [
        jpart('head', '柔らかい頭甲', 'shell', (0.8, 0.8, 0.75), [(J.m(1250, 720), J.m(1370, 850), 0.3)], dur=60, flinch=(35, 20, 40, False)),
        jpart('hooks', '外側の幼鉤', 'shell', (0.6, 0.7, 0.6), [(J.m(385, 365, 0.35), J.m(935, 205, 0.35), 0.24), (J.m(385, 365, -0.35), J.m(935, 205, -0.35), 0.24)], dur=70),
        jpart('tail', '尾節', 'hide', (0.85, 0.8, 0.8), [(J.m(180, 790), J.m(300, 960), 0.3)]),
        jpart('body', '体節', 'shell', (0.7, 0.75, 0.7), [(J.m(265, 510), J.m(560, 250), 0.34), (J.m(560, 250), J.m(935, 205), 0.34), (J.m(935, 205), J.m(1205, 560), 0.34)], flinch=(60, 30, 90, True)),
    ],
    moves=MV.mitogaron_moves, idle=MV.MITOGARON_IDLE,
    mats=[('juv_hook', '幼鉤甲', 12), ('soft_ring', '柔輪節', 16), ('thin_duct', '細痺液管', 24)],
    quest=('丸まれない輪', 3, 'テンガロの幼体ミトガロンの群れが、盆地の倒れた岩の間を這っている。3 体を討伐する。尾節から落ちる痺液に注意。'),
))

# ---- 20 ユルテピカ（ヴェリトの幼体。多脚の虫）----
P_ = BY_KEY['verito']
J = Juv('yurtepica', 'verito', P_['sp'], P_['plan'], 1.8, tail_k=0.75, head=1.3, extra_k=0.55, eye_k=1.5,
        drop=lambda e, k: e.get('part') == 'spinner' and k not in (0, 3), tint=(1.1, 1.08, 1.1), pale=0.12)
for e in J.plan['extras']:
    if e.get('ch') == 'bags':
        e['r'][1] = round(e['r'][1] * 0.55)  # 平たい羽袋
JUVENILES.append(dict(
    J=J, no=20, name='絹霧蟲の幼体 ユルテピカ', parent='verito', frame='bug', rig='crust_many',
    stats=dict(hp=140, bodyRadius=0.36, turn=180, moveSpeed=2.6, approach=(1.2, 60), collision=[(0.0, 0.36)], cooldown=(35, 70)),
    herd=herd((4, 8), 1.7, 18, 9, 1.7, 300, 0.25, (180, 300)),
    parts=lambda J: [
        jpart('bag', '左の幼羽袋', 'hide', (0.9, 0.85, 0.9), [(J.m(700, 330, 0.4), J.m(1200, 300, 0.4), 0.22), (J.m(700, 330, -0.4), J.m(1200, 300, -0.4), 0.22)], dur=40),
        jpart('spinner', '尾の細紡糸管', 'hide', (0.85, 0.8, 0.8), [(J.m(420, 600), J.m(200, 610), 0.2)], dur=30),
        jpart('head', '頭', 'hide', (0.9, 0.85, 0.85), [(J.m(1260, 575), J.m(1360, 590), 0.2)], flinch=(30, 18, 40, False)),
        jpart('body', '胴', 'shell', (0.75, 0.75, 0.7), [(J.m(400, 605), J.m(1150, 600), 0.3)]),
        jpart('legs', '脚', 'shell', (0.7, 0.7, 0.65), [(J.m(950, 660, 0.4), J.m(980, 940, 1.15), 0.12), (J.m(950, 660, -0.4), J.m(980, 940, -1.15), 0.12)], flinch=(50, 25, 80, True)),
    ],
    moves=MV.yurtepica_moves, idle=MV.YURTEPICA_IDLE,
    mats=[('juv_silk', '幼霧糸', 10), ('thin_bag', '薄羽袋', 16), ('weak_venom', '微毒紡液', 22)],
    quest=('糸床の子ら', 4, 'ヴェリトの幼体ユルテピカの群れが、盆地の谷に小さな糸床を張った。4 体を討伐する。尾糸を払う毒に注意。'),
))

# ---- 21 ヒナサルヴ（キリサーヴの幼体。長胴獣）----
P_ = BY_KEY['kirisave']
_hina_legs = [
    dict(group='F', attach=7, pts=[[1300, 500, 0.5], [1290, 560, 0.75], [1320, 612, 0.85]], r=[42, 34, 26], mirror=True, phase=0.0, foot=[90, 18]),
    dict(group='H', attach=4, pts=[[700, 540, 0.5], [680, 585, 0.75], [690, 612, 0.85]], r=[42, 34, 26], mirror=True, phase=0.5, foot=[90, 18]),
]
J = Juv('hinasalv', 'kirisave', P_['sp'], P_['plan'], 4.6, tail_k=0.75, head=1.3, extra_k=0.4, eye_k=1.6, add_legs=_hina_legs, tint=(1.12, 1.12, 1.12), pale=0.12)
JUVENILES.append(dict(
    J=J, no=21, name='氷帆蛇の幼体 ヒナサルヴ', parent='kirisave', frame='serpent', rig='long',
    stats=dict(hp=300, bodyRadius=0.42, turn=120, moveSpeed=2.8, approach=(1.6, 55), collision=[(0.6, 0.42), (-0.6, 0.4)], cooldown=(45, 85)),
    herd=herd((2, 4), 3.0, 20, 10, 1.6, 420, 0.4, (240, 420)),
    parts=lambda J: [
        jpart('head', '頭の幼冷晶板', 'shell', (0.85, 0.85, 0.8), [(J.m(1600, 375), J.m(1745, 375), 0.24)], dur=60, flinch=(35, 20, 40, False)),
        jpart('sails', '左右交互の小帆板', 'shell', (0.65, 0.75, 0.6), [(J.m(1350, 400), J.m(500, 470), 0.3)], dur=70),
        jpart('tail', '尾', 'hide', (0.85, 0.8, 0.8), [(J.m(450, 505), J.m(60, 492), 0.2)]),
        jpart('body', '胴', 'hide', (0.75, 0.75, 0.7), [(J.m(500, 505), J.m(1500, 420), 0.3)], flinch=(60, 30, 90, True)),
    ],
    moves=MV.hinasalv_moves, idle=MV.HINASALV_IDLE,
    mats=[('juv_sail', '幼氷帆', 14), ('small_crystal', '小冷晶', 18), ('thin_skin', '薄帆間皮', 12)],
    quest=('小板の兄弟', 2, 'キリサーヴの幼体ヒナサルヴが、2〜4 頭で冷えた岩溝を移っている。2 頭を討伐する。背の小板が白くなったら、氷の粒が散る。'),
))

# 種をまたぐ群れの依頼（盆地に住む 2 種）
MIXED_QUESTS = [
    dict(id='quest.basin_young.r1', name='盆地の若い群れ', targets=[('kordopil', 2), ('palseit', 3)],
         summary='風礫盆地に、幼体の群れが増えすぎた。コルドピル 2 頭とパルセイト 3 頭を討伐する。群れは住みかのエリアを移ることがある。', money=520),
]


def build_juvenile(spec):
    J = spec['J']
    key = J.key
    mid = f'monster.{key}'
    st = spec['stats']
    actions, tracks, curves, choices, clips, plan_moves = build_moves(key, mid, spec['moves'](J), spec['frame'])
    mdef = {
        'schemaVersion': 1, 'id': mid, 'name': spec['name'], 'rigFamily': spec['rig'], 'assetId': f'model.monster.{key}',
        'hp': st['hp'], 'bodyRadius': st['bodyRadius'], 'turnDegPerSec': st['turn'], 'moveSpeed': st['moveSpeed'], 'captureAllowed': False,
        **marks(mid),
        'lootId': f'loot.{key}', 'respawnTicks': None, 'breakStaggerTicks': 50,
        'collision': [{'z': z, 'r': r} for z, r in st['collision']],
        'approach': {'stopDist': st['approach'][0], 'faceDeg': st['approach'][1]},
        'discover': None,
        'parentId': f'monster.{spec["parent"]}',
        'herd': spec['herd'],
        'parts': spec['parts'](J),
        'ai': {'aggroRange': 30, 'cooldownTicks': list(st['cooldown']), 'choices': choices},
    }
    return mdef, actions, tracks, curves, clips, plan_moves


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


def openings_doc():
    """後隙の反撃（v0.73.0。D-171）の一覧 docs/monster-openings.md: 大型（足を踏み替える向き直りを持つ種）の攻撃の技ごとに、狙える部位と区間。
    いま書いた技データ（public/data/actions/）から作る。ガルドロスの技（galdros.json は手で書く。galdros_ext.json は tools/gen-galdros-moves.mjs）も読む。"""
    rows = ['# 大型の技の後隙に、狙える部位（後隙の反撃）', '',
            '`npm run monsters:gen` の出力（手で編集しない）。決まりは docs/spec.md の 32.39、検査は tests/creature-openings.test.ts。', '',
            '- 区間は、技の始めから数えた tick（60 tick = 1 秒）。その間、部位の下の端は 1.6m 以下で、ほとんど動かない。',
            '- 大技 = その種のいちばん強い一撃の 9 割以上の技（区間は 30 tick 以上。ほかは 20 tick 以上）。',
            '- 「−」は、隙を作らない技（退きながら当てる技・遠くの相手へ撃つ技）と、ガルドロスの横への体当たり（いまの動きでは、止まる間が短い）。', '']
    mdir = os.path.join(DATA, 'monsters')
    for fn in sorted(os.listdir(mdir)):
        with open(os.path.join(mdir, fn), encoding='utf-8') as f:
            m = json.load(f)
        if 'turnSteps' not in m:
            continue
        key = fn[:-5]
        acts = []
        for af in (f'{key}.json', f'{key}_ext.json'):
            ap = os.path.join(DATA, 'actions', af)
            if os.path.exists(ap):
                with open(ap, encoding='utf-8') as f:
                    acts += json.load(f)['actions']
        dmg = lambda a: max([h.get('baseDamage', 0) for h in a['hitWindows']] + [h.get('baseDamage', 0) for h in a.get('hazards', [])] + [0])
        atk = [a for a in acts if a['hitWindows'] or a.get('hazards')]
        top = max(dmg(a) for a in atk)
        pname = {p['id']: p.get('name', p['id']) for p in m['parts']}
        n = sum(1 for a in atk if a.get('opening'))
        rows += [f'## {m["name"]}（`{m["id"]}`。{n} / {len(atk)}）', '', '| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |', '| --- | --- | --- | --- | --- |']
        for a in atk:
            o = a.get('opening')
            name = a['actionId'].split('.')[-1]
            heavy = '大技' if dmg(a) >= 0.9 * top else ''
            if o:
                rows.append(f'| `{name}` | {pname[o["partId"]]}（`{o["partId"]}`） | {o["from"]}〜{o["to"]} | {o["to"] - o["from"]} | {heavy} |')
            else:
                rows.append(f'| `{name}` | − | − | − | {heavy} |')
        rows.append('')
    return '\n'.join(rows)


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


# 顎（v0.25.0。ChatGPT の設計提案 #6）: 頭の下に顎の骨がある体つき（src/render/creatureRig.ts の CreatureBody.jawBone）と、口を使う技
JAW_FRAMES = ('quad', 'biped', 'serpent')
BITE_MOVES = ('bite', 'double_bite', 'pounce', 'peck', 'peck_combo', 'beak_thrust')


def add_jaw(name, anim):
    """口を開ける動きを、技の鍵の姿勢へ足す（もう jaw が書いてある鍵は、そのまま）。
    咆哮は攻撃の区間で大きく開け、威嚇は半分開ける。噛む・つつく技は、構えの終わりで開けて、攻撃で閉じる
    （攻撃の区間に鍵がいくつもある技は、閉じる・開けるを繰り返す）。"""
    keys = anim['K']

    def put(k, v):
        if 'jaw' not in k['pose']:
            k['pose']['jaw'] = v
    w = [k for k in keys if k['p'] == 'w']
    st = [k for k in keys if k['p'] == 's']
    if name == 'roar':
        if w:
            put(w[-1], 0.3)
        for k in st:
            put(k, 0.95)
        for k in keys:
            if k['p'] == 'r' and k['t'] <= 0.6:
                put(k, 0.55)
    elif name == 'threat':
        for k in st:
            put(k, 0.5)
    elif name in BITE_MOVES:
        if w:
            put(w[-1], 0.85)
        for i, k in enumerate(st):
            put(k, 0.05 if i % 2 == 0 else 0.75)


def add_opening(mv, a1, dur):
    """後隙の反撃（v0.73.0。#19 の M02。D-171）: 隙の終わりの tick に、止まる姿勢と同じ姿勢（わずかに戻した形）の鍵を足して、隙の区間（tick）を返す。
    区間と止まる姿勢は tools/monster_lib.py の opened(...) が決めてある。区間の両端は、部位の追従の表の刻み（6 tick）の上:
    表は刻みの間をまっすぐつなぐので、刻みの上に鍵が無いと、区間の端で部位が動いて見える。"""
    part, t0, t1, relax = mv['open']
    rec = dur - a1
    keys = mv['anim']['K']
    k0 = next(k for k in keys if k.get('open'))
    del k0['open']
    hold = {'p': 'r', 't': round((t1 - a1) / rec, 5), 'pose': ML._clean({kk: ML.scale({kk: vv}, relax)[kk] for kk, vv in k0['pose'].items()}), 'e': 'lin'}
    keys.insert(keys.index(k0) + 1, hold)
    return {'partId': part, 'from': t0, 'to': t1}


def build_moves(key, mid, moves, frame=None, parts=()):
    """技の一覧から、技データ・軌道・曲線・AI の選び方・clip・見た目の動きの対応を作る。"""
    actions, tracks, curves, choices, clips, plan_moves = [], [], [], [], [], {}
    for mv in moves:
        if frame in JAW_FRAMES:
            add_jaw(mv['name'], mv['anim'])
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
        if mv.get('spinDeg'):
            # 足を踏み替える向き直り（v0.65.0。#19 の M01）: 技の始まりから終わりまでの間に、体ごと回る（simulation の向き）
            a['spin'] = {'from': a0, 'to': a1, 'degrees': mv['spinDeg']}
        if mv.get('brake'):
            # 突進の制動（v0.66.0。#19 の M02。ガルドロスと同じ形）: 走る間に前へ進めなくなったら、走る区間の終わりへ進める
            a['brake'] = {'from': mv['brake'][0], 'to': mv['brake'][1]}
        if mv.get('open'):
            # 後隙の反撃（v0.73.0。#19 の M02）: 後隙の間に、狙える部位が低い所で止まる区間
            assert isinstance(mv['open'], tuple) and len(mv['open']) == 4, f'{aid}: 技の一覧を opened(...) に通す'
            assert not parts or mv['open'][0] in parts, (aid, mv['open'][0], parts)
            a['opening'] = add_opening(mv, a1, dur)
        elif parts and (mv['hits'] or mv['hazards']):
            # 大型（部位を渡された種）の攻撃の技は、隙を作るか、作らないと書いてある
            assert mv.get('open') is False, f'{aid}: 攻撃の技は open を書く（隙を作らない技は open=False）'
        a['hitWindows'] = mv['hits']
        a['cancelWindows'] = []
        # 体の部位に付けた判定（v0.21.0）: 軌道は npm run monsters:bake が動きから作る。ここでは仮の形を置く
        known = {t['id'] for t in mv['tracks']}
        for b in mv['bind']:
            assert any(h['shapeTrack'] == b['track'] for h in mv['hits']), (aid, b['track'])
            if b['track'] not in known:
                mv['tracks'].append({'id': b['track'], 'radius': b['r'], 'from': 0, 'to': 1.0, 'keys': [{'t': 0, 'grip': [0, 1, 0], 'dir': [0, 0, 1]}]})
                known.add(b['track'])
        for h in mv['hits']:
            assert h['shapeTrack'] in known, (aid, h['shapeTrack'])
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
        pm = {'def': mv['anim']}
        if mv['side']:
            pm['side'] = mv['side']
        if mv['amp']:
            pm['amp'] = mv['amp']
        if mv['bind']:
            pm['bind'] = mv['bind']
        plan_moves[clip] = pm
    return actions, tracks, curves, choices, clips, plan_moves


ELEMENTS = {'fire', 'thunder', 'ice', 'water', 'wind', 'mist'}
_BESTIARY = None


def marks(mid):
    """属性の印（v0.33.0）: 技の属性・弱点・耐性。登録簿（bestiary.json）の elements・weak・resist を写す（検査が同じか確かめる）"""
    global _BESTIARY
    if _BESTIARY is None:
        with open(os.path.join(DATA, 'bestiary.json'), encoding='utf-8') as f:
            _BESTIARY = {s['id']: s for s in json.load(f)['species']}
    b = _BESTIARY[mid]
    els = [e for e in b.get('elements', []) if e != 'none']
    assert len(els) <= 1 and all(e in ELEMENTS for e in els + b['weak'] + b['resist']), mid
    out = {}
    if els:
        out['element'] = els[0]
    out['weak'] = b['weak']
    out['resist'] = b['resist']
    return out


def build_species(spec):
    s = spec['sp']
    key = s.key
    mid = f'monster.{key}'
    st = spec['stats']
    parts = spec['parts'](s)
    actions, tracks, curves, choices, clips, plan_moves = build_moves(key, mid, spec['moves'](s), spec['frame'], [p['id'] for p in parts])
    roar = f'{mid}.roar'
    # 足を踏み替える向き直り（v0.65.0。#19 の M01。ガルドロスと同じ形）: 正面から faceDeg を外れた相手へは、90° か（backDeg より後ろなら）180° 回る。
    # 大型はどれも 4 つの技（turn_l90・turn_r90・turn_l180・turn_r180）を持つ
    ids = {a['actionId'] for a in actions}
    turns = {k: f'{mid}.turn_{k}' for k in ('l90', 'r90', 'l180', 'r180')}
    steps = {}
    if all(v in ids for v in turns.values()):
        face, back = st.get('turnSteps', (50, 130))
        steps = {'turnSteps': {'faceDeg': face, 'backDeg': back, 'left': turns['l90'], 'right': turns['r90'], 'backLeft': turns['l180'], 'backRight': turns['r180']}}
    mdef = {
        'schemaVersion': 1, 'id': mid, 'name': spec['name'], 'rigFamily': spec['rig'], 'assetId': f'model.monster.{key}',
        'hp': st['hp'], 'bodyRadius': st['bodyRadius'], 'turnDegPerSec': st['turn'], 'moveSpeed': st['moveSpeed'], 'captureAllowed': True,
        **marks(mid),
        'lootId': f'loot.{key}', 'capture': {'hpRatio': 0.25, 'tranqNeeded': 2, 'tranqDecayTicks': 900}, 'respawnTicks': None, 'breakStaggerTicks': 80,
        'collision': [{'z': z, 'r': r} for z, r in st['collision']],
        'approach': {'stopDist': st['approach'][0], 'faceDeg': st['approach'][1]},
        **steps,
        'discover': {'range': st['discover'][0], 'fovDeg': st['discover'][1], 'closeRange': st['discover'][2], 'actionId': roar},
        'rage': {'threshold': st['rage'][0], 'durationTicks': st['rage'][1], 'actionId': roar, 'speedScale': st['rage'][2], 'damageScale': st['rage'][3], 'cooldownScale': st['rage'][4]},
        'parts': parts,
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
    """一覧（list_key の中）から、id / itemId が prefixes で始まる件を除き、rows を最後へ足す。
    1 行 1 件の JSON は、その形のまま書く。2 字下げの JSON（商店は ChatGPT の #40 でこの形になった）は、読んで 2 字下げで書き直す
    （v0.66.0。行で書くと、2 字下げの一覧を壊していた）。"""
    full = os.path.join(ROOT, path)
    text = open(full, encoding='utf-8').read()
    doc = json.loads(text)
    if json.dumps(doc, ensure_ascii=False, indent=2) + '\n' == text:
        key = lambda r: str(r.get('id', r.get('itemId', '')))
        fresh = {key(r): r for r in rows}
        out = []
        for r in doc[list_key]:
            k = key(r)
            if any(k.startswith(p) for p in prefixes):
                # もうある件は、その場所のまま中身だけ替える（並びを変えない）。無くなった件は除く
                if k in fresh:
                    out.append(fresh.pop(k))
                continue
            out.append(r)
        doc[list_key] = out + [r for r in rows if key(r) in fresh]
        open(full, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
        return
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
    """素材台帳の、この生成器が書く素材を差し替える。もうある素材は、その場所のまま中身だけ替える（並びを変えない。v0.25.0）。無い素材は終わりに足す。
    台帳は 2 字下げの JSON（v0.60.0 の後に、1 素材 1 行から変わった）。読んで書き直す（v0.65.0。行で探すと、見つからずに同じ素材を足していた）。"""
    full = os.path.join(ROOT, 'docs', 'asset-manifest.json')
    doc = json.loads(open(full, encoding='utf-8').read())
    by_id = {e['id']: e for e in entries}
    assets = doc['assets']
    for i, a in enumerate(assets):
        if a.get('id') in by_id:
            assets[i] = by_id.pop(a['id'])
    assets.extend(by_id.values())
    ids = [a.get('id') for a in assets]
    assert len(ids) == len(set(ids)), '素材台帳に同じ id がある'
    open(full, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')


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
    text = json.dumps(idx, ensure_ascii=False, indent=2) + '\n'
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
        if key in D15.RANK_SPECIES:
            mdef = {**{k: v for k, v in mdef.items() if k not in ('parts', 'ai')}, 'lootByRank': {f'rank.{r}': f'loot.{key}.r{r}' for r in D15.RANKS}, 'parts': mdef['parts'], 'ai': mdef['ai']}
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
        if key in D15.RANK_SPECIES:
            rm, rmats, rsells = rank_materials(key, {mid_: price for (slug, name, price), mid_ in zip(spec['mats'], mat_ids)})
            mats += rmats
            sells += rsells
            loots += rank_tables(key, loot, rm)
            for r in D15.RANKS:
                rname, rsum = RANK_TEXT[(key, r)]
                main = next(m['id'] for m in rm if m['rank'] == r and m['role'] == 'main')
                quests.append({
                    'id': f'quest.{key}.r{r}', 'name': rname, 'kind': 'hunt', 'summary': rsum, 'mapId': 'map.basin.training', 'fieldId': 'field.basin',
                    'targetMonsterId': f'monster.{key}', 'rankId': f'rank.{r}', 'requires': [RANK_GATE[r]], 'monsterSpawn': {'x': 4, 'z': 15, 'yaw': 2.6},
                    'timeLimitTicks': 54000, 'fieldTimeLimitTicks': RANK_FIELD_TICKS[r], 'maxFaints': 3, 'returnTicks': 3600,
                    'supplies': [{'itemId': 'item.heal_tonic', 'count': 5}, {'itemId': 'item.bind_trap', 'count': 1}, {'itemId': 'item.calm_orb', 'count': 3}, {'itemId': 'item.whetstone', 'count': 3}],
                    'rewards': {'money': round_to(600 * RANK_MONEY[r], 10), 'items': [{'itemId': main, 'count': 1}]},
                })
        # 素材台帳
        manifest.append({'id': f'model.monster.{key}', 'name': spec['name'], 'type': 'model', 'use': f'大型モンスター（登録簿 {spec["no"]:02d}。v0.17.0 で遊べるようにした）', 'owner': 'ChatGPT（原画）→ Claude（仮モデル・動き）',
                         'status': 'concept', 'version': 0, 'path': None, 'source': f'原画 1 枚（art-source/monster/concepts/monster_{spec["no"]:02d}_{key}_concept_v2.png。採用待ち）を横から貼った仮の形。設定図（4 方向）・正式モデルは無い',
                         'terms': '本作オリジナル', 'dims': f'全長 約 {(max(p[0] for p in spec["plan"]["spine"]) - min(p[0] for p in spec["plan"]["spine"])) * s.s:.1f}m（登録簿の全長の約 0.68 倍）。Y 上・+Z 前',
                         'clips': clips, 'dependsOn': [f'tex.monster.{key}.side', f'tex.monster.{key}.skin'],
                         'placeholder': {'kind': 'procedural', 'source': 'src/render/creatureRig.ts', 'note': f'形は src/render/creaturePlans.ts（tools/gen-monsters.py）。体つき {spec["frame"]}。骨の通った 1 枚の面に、原画を横から貼る。動きは種ごとの鍵の姿勢（tools/monster_moves.py → src/render/creaturePlans.ts。v0.21.0）'},
                         'verification': 'ヘッドレス Chrome の画面で、形と原画の重なりと、技の動き（v0.21.0 の全部の技を 5 つの時点で止めた絵）を目で確かめた。体の部位の判定と動きの一致は npm run test で検査。実機では未確認'})
        manifest.append({'id': f'tex.monster.{key}.side', 'name': f'{spec["name"]}の横から貼る絵', 'type': 'image', 'use': '仮モデルの体へ横から貼る色の絵', 'owner': 'Claude（原画から生成）', 'status': 'integrated', 'version': 1,
                         'path': f'assets/textures/monsters/{key}_side_v1.webp', 'source': f'art-source/monster/concepts/monster_{spec["no"]:02d}_{key}_concept_v2.png を tools/monster-art.py で加工（背景を抜き、体の外の色を近くの体の色で埋めた）',
                         'terms': '本作オリジナル（ChatGPT の原画からの二次加工。原画は採用待ち）', 'dims': '幅 1024px 以下の WebP'})
        manifest.append(skin_entry(key, spec['name'], f'art-source/monster/concepts/monster_{spec["no"]:02d}_{key}_concept_v2.png', '本作オリジナル（ChatGPT の原画からの二次加工。原画は採用待ち）'))
        nturn = sum(1 for a in actions if '.turn_' in a['actionId'])
        states[f'monster.{key}'] = (f'実装済み（v0.17.0。技と動きは v0.21.0 で {len(actions) - nturn} に。登録簿の 4 つ・咆哮・威嚇・退き・種に固有の技。'
                                    + (f'v0.65.0 から、足を踏み替える向き直り {nturn} つ。' if nturn else '')
                                    + ('初級〜極級の依頼 4 件（中級から先は v0.34.0）。' if key in D15.RANK_SPECIES else '初級の依頼 1 件。')
                                    + ('形は原画 1 枚から作った仮の形。狩場は風礫盆地）' if key in D15.RANK_SPECIES else '形は原画 1 枚から作った仮の形。狩場は風礫盆地を借りている）'))
        plans.append(dict(key=key, frame=spec['frame'], scale=s.s, origin=[s.ox, s.gy], **{k: v for k, v in spec['plan'].items()}, moves=plan_moves,
                          **({'idle': spec['idle']} if spec.get('idle') else {})))

    # ---- 幼体 8 種（v0.18.0）----
    herd_quests = []
    for spec in JUVENILES:
        J = spec['J']
        key = J.key
        mdef, actions, tracks, curves, clips, plan_moves = build_juvenile(spec)
        if key in D15.RANK_SPECIES:
            mdef = {**{k: v for k, v in mdef.items() if k not in ('parts', 'ai')}, 'lootByRank': {f'rank.{r}': f'loot.{key}.r{r}' for r in D15.RANKS}, 'parts': mdef['parts'], 'ai': mdef['ai']}
        write(f'public/data/monsters/{key}.json', monster_json(mdef))
        write(f'public/data/actions/{key}.json', list_doc({'schemaVersion': 1, 'note': f'{spec["name"]}の技（tools/gen-monsters.py の出力。手で編集しない）。数値は机上の値。'}, 'actions', actions))
        write(f'public/data/tracks/{key}.json', list_doc({'schemaVersion': 1, 'note': f'{spec["name"]}の攻撃の判定の形（tools/gen-monsters.py の出力。手で編集しない）。'}, 'tracks', tracks))
        actions_files.append(f'actions/{key}.json')
        tracks_files.append(f'tracks/{key}.json')
        monster_files.append(f'monsters/{key}.json')
        all_curves += curves
        mat_ids = [f'mat.{key}.{slug}' for slug, _, _ in spec['mats']]
        for (slug, name, price), mid_ in zip(spec['mats'], mat_ids):
            mats.append({'id': mid_, 'name': name})
            sells.append({'itemId': mid_, 'price': price})
        weights = [60, 40] if len(mat_ids) == 2 else [50, 32, 18]
        jloot = {'id': f'loot.{key}', 'carve': {'count': 1, 'table': [{'itemId': i, 'weight': w} for i, w in zip(mat_ids, weights)]},
                 'capture': {'count': 1, 'table': [{'itemId': mat_ids[0], 'weight': 1}]}, 'breaks': {}}
        loots.append(jloot)
        qname, count, qsum = spec['quest']
        herd_quests.append({
            'id': f'quest.{key}.pack1', 'name': qname, 'kind': 'slay', 'summary': qsum, 'mapId': 'map.basin.training', 'fieldId': 'field.basin',
            'targetMonsterId': f'monster.{key}', 'targets': [{'monsterId': f'monster.{key}', 'count': count}], 'rankId': 'rank.1',
            'monsterSpawn': {'x': 4, 'z': 15, 'yaw': 2.6}, 'timeLimitTicks': 36000, 'maxFaints': 3, 'returnTicks': 1800,
            'supplies': [{'itemId': 'item.heal_tonic', 'count': 3}, {'itemId': 'item.whetstone', 'count': 2}],
            'rewards': {'money': 300 + 30 * count, 'items': [{'itemId': mat_ids[0], 'count': 1}]},
        })
        if key in D15.RANK_SPECIES:
            rm, rmats, rsells = rank_materials(key, {mid_: price for (slug, name, price), mid_ in zip(spec['mats'], mat_ids)})
            mats += rmats
            sells += rsells
            loots += rank_tables(key, jloot, rm)
            for r in D15.RANKS:
                rname, rsum = RANK_TEXT[(key, r)]
                main = next(m['id'] for m in rm if m['rank'] == r and m['role'] == 'main')
                herd_quests.append({
                    'id': f'quest.{key}.pack.r{r}', 'name': rname, 'kind': 'slay', 'summary': rsum, 'mapId': 'map.basin.training', 'fieldId': 'field.basin',
                    'targetMonsterId': f'monster.{key}', 'targets': [{'monsterId': f'monster.{key}', 'count': count}], 'rankId': f'rank.{r}', 'requires': [RANK_GATE[r]],
                    'monsterSpawn': {'x': 4, 'z': 15, 'yaw': 2.6}, 'timeLimitTicks': 36000, 'maxFaints': 3, 'returnTicks': 1800,
                    'supplies': [{'itemId': 'item.heal_tonic', 'count': 3}, {'itemId': 'item.whetstone', 'count': 2}],
                    'rewards': {'money': round_to((300 + 30 * count) * RANK_MONEY[r], 10), 'items': [{'itemId': main, 'count': 1}]},
                })
        art_tex = f'tex.monster.{J.art}.side'
        manifest.append({'id': f'model.monster.{key}', 'name': spec['name'], 'type': 'model', 'use': f'幼体（登録簿 {spec["no"]:02d}。v0.18.0 で遊べるようにした。群れで暮らす）', 'owner': 'Claude（仮モデル・動き）',
                         'status': 'concept', 'version': 0, 'path': None,
                         'source': f'親の{"設定図（右側面）" if J.art == "galdros" else "原画"}の形を、尾を縮め・頭を大きく・飾りを小さくした仮の形（tools/gen-monsters.py の Juv）。幼体自身の原画案（v0.24.0 受領。採用待ち）は図鑑に出すだけで、形にはまだ使っていない',
                         'terms': '本作オリジナル', 'dims': f'全長 約 {J.span * J.s:.1f}m（登録簿の全長の約 0.68 倍）。Y 上・+Z 前',
                         'clips': clips, 'dependsOn': [art_tex, f'tex.monster.{J.art}.skin'],
                         'placeholder': {'kind': 'procedural', 'source': 'src/render/creatureRig.ts', 'note': f'形は src/render/creaturePlans.ts。体つき {spec["frame"]}。親の絵を淡くして貼る。群れの気分（食む・見る・伏せる・逃げる）の姿勢は src/render/creatureRig.ts'},
                         'verification': 'ヘッドレス Chrome の画面で、形と群れの動きと、技の動き（v0.21.0）を目で確かめた。体の部位の判定と動きの一致は npm run test で検査。実機では未確認'})
        if J.art == 'galdros':
            manifest.append({'id': 'tex.monster.galdros.side', 'name': 'ガルドロスの横から貼る絵（幼体コルドピル用）', 'type': 'image', 'use': '幼体コルドピルの仮モデルへ横から貼る色の絵', 'owner': 'Claude（設定図から生成）',
                             'status': 'integrated', 'version': 1, 'path': 'assets/textures/monsters/galdros_side_v1.webp',
                             'source': 'art-source/monster/galdros/galdros_right_v1.png（採用済みの設定図）を tools/monster-art.py で加工（背景を抜き、体の外の色を近くの体の色で埋めた）',
                             'terms': '本作オリジナル', 'dims': '幅 1024px 以下の WebP'})
            manifest.append(skin_entry('galdros', 'ガルドロス', 'art-source/monster/galdros/galdros_right_v1.png（採用済みの設定図）', '本作オリジナル'))
        states[f'monster.{key}'] = (f'実装済み（v0.18.0。技と動きは v0.21.0 で {len(actions)} に。登録簿の 3 つ・威嚇・子に固有の技。'
                                    + ('群れの依頼は初級〜極級の 4 件（中級から先は v0.34.0）' if key in D15.RANK_SPECIES else '群れの依頼 1 件') + '。形は親の絵から作った仮の形。狩場は風礫盆地）'
                                    '。幼体自身の原画案（ChatGPT、2026-11-25 受領。採用待ち）を図鑑に出す（体はまだ親の絵から）')
        plans.append(dict(key=J.art, frame=spec['frame'], **{k: v for k, v in J.plan.items() if k not in ('key', 'frame')}, moves=plan_moves, monster=key,
                          **({'idle': spec['idle']} if spec.get('idle') else {})))
    for mq in MIXED_QUESTS:
        tg = [{'monsterId': f'monster.{k}', 'count': n} for k, n in mq['targets']]
        herd_quests.append({
            'id': mq['id'], 'name': mq['name'], 'kind': 'slay', 'summary': mq['summary'], 'mapId': 'map.basin.training', 'fieldId': 'field.basin',
            'targetMonsterId': tg[0]['monsterId'], 'targets': tg, 'rankId': 'rank.1', 'monsterSpawn': {'x': 4, 'z': 15, 'yaw': 2.6}, 'timeLimitTicks': 36000, 'maxFaints': 3,
            'returnTicks': 1800, 'supplies': [{'itemId': 'item.heal_tonic', 'count': 3}, {'itemId': 'item.whetstone', 'count': 2}],
            'rewards': {'money': mq['money'], 'items': [{'itemId': f'mat.{mq["targets"][0][0]}.{[j for j in JUVENILES if j["J"].key == mq["targets"][0][0]][0]["mats"][0][0]}', 'count': 1}]},
        })
    write('public/data/quests_herds.json', list_doc({'schemaVersion': 1, 'note': '幼体の群れの依頼（tools/gen-monsters.py の出力。手で編集しない）。targets の頭数を討伐すると達成。狩場は風礫盆地（群れの住みかは fields/basin.json の herds）。コルドピルとパルセイトは中級〜極級も（v0.34.0。級はガルドロスの段の道で開く）。報酬は机上の値'}, 'quests', herd_quests))

    # 曲線・依頼・素材・剥ぎ取り
    write('public/data/curves_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種と幼体 8 種の技で進む距離（tools/gen-monsters.py の出力。手で編集しない）。keys は [tick, 累積距離 m]'}, 'curves', all_curves))
    write('public/data/quests_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種の依頼（tools/gen-monsters.py の出力。手で編集しない）。初級は最初から受けられる。狩場は風礫盆地を借りている（本来の狩場は登録簿の habitat）。セルヴァルクは中級〜極級も（v0.34.0。設計 #15 の上の級の狩場が風礫盆地の種。級はガルドロスの段の道で開く）。報酬は机上の値'}, 'quests', quests))
    write('public/data/items_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種と幼体 8 種の素材（登録簿の素材の名前。tools/gen-monsters.py の出力。手で編集しない）', 'items': []}, 'materials', mats))
    write('public/data/loot_creatures.json', list_doc({'schemaVersion': 1, 'note': '大型 11 種と幼体 8 種の剥ぎ取り・捕獲・部位破壊（tools/gen-monsters.py の出力。手で編集しない）。幼体は剥ぎ取り 1 回（捕獲はできない。capture は形だけ）。重みは机上の値'}, 'tables', loots))
    replace_rows('public/data/shop.json', 'sell', [f'mat.{spec["sp"].key}.' for spec in SPECIES] + [f'mat.{spec["J"].key}.' for spec in JUVENILES], sells)
    update_content_index({'actions': actions_files, 'tracks': tracks_files, 'monsters': monster_files, 'curves': ['curves_creatures.json'], 'quests': ['quests_creatures.json', 'quests_herds.json'],
                          'items': ['items_creatures.json'], 'loot': ['loot_creatures.json']})
    update_manifest(manifest)
    update_bestiary(states)

    # 見た目の設計図
    out = ['// 生成物（npm run monsters:gen = tools/gen-monsters.py）。手で編集しない。型は src/render/creaturePlan.ts。',
           "import type { CreaturePlan } from './creaturePlan';", '',
           '/** モンスターの id → 仮モデルの設計図 */', 'export const CREATURE_PLANS: Record<string, CreaturePlan> = {']
    for p in plans:
        mkey = p.pop('monster', p['key'])
        out.append(f"  'monster.{mkey}': {json.dumps(p, ensure_ascii=False)},")
    out.append('};')
    write('src/render/creaturePlans.ts', '\n'.join(out) + '\n')
    write('docs/monster-openings.md', openings_doc())
    print(f'{len(SPECIES)} 種: 技 {sum(len(sp["moves"](sp["sp"])) for sp in SPECIES)}、依頼 {len(quests)}')
    print(f'幼体 {len(JUVENILES)} 種: 技 {sum(len(j["moves"](j["J"])) for j in JUVENILES)}、群れの依頼 {len(herd_quests)}')
    print(f'曲線 {len(all_curves)}、素材 {len(mats)}')
    for j in JUVENILES:
        J = j['J']
        print(f'  {J.key:12s} 全長 {J.span * J.s:.2f}m  縮尺 {J.s:.5f}  親との比 {J.ratio:.3f}')


if __name__ == '__main__':
    main()
