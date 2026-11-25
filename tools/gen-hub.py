#!/usr/bin/env python3
"""里（灯継ぎの里）の地形と当たりを作る（v0.35.0。ChatGPT の里の設計 #11 の P1。docs/spec.md の 19.2）。

  入力: public/data/hub.json（施設・建物と飾り・人・小物の位置。手で書く）
  出力: public/data/maps/hub_village.json（段差 platforms と当たり rocks。手で編集しない。npm run hub:gen）

段の高さ（設計 #11 の相対床高）: 水音の庭 -10 / 炉の段 -3 / 灯の広場 0（段差の無い地面）/ 暮らしの段 +8 / 灯見の台 +22。
地面の高さは、重なる段差のうち最も高いもの（無ければ 0。src/game/world.ts の groundAt）。上の段の中に、それより低い階段や
踊り場を置く所は、上の段を、それを除いた四角に分けて書く（subtract）。
階段は、蹴上げ 1/6m・踏面 0.3m・幅 3m（設計 #11 の 4 章: 蹴上げ 0.15〜0.18m、踏面 0.28〜0.32m、幅 2.5〜3.0m）。踊り場は 4.5m 以上。
どこも、跳ばずに歩ける（上りは stepUp 0.35m まで、下りは stepDown 0.4m まで。それより深い下りは壁で、段の縁から落ちない）。

回遊路（設計 #11 の 3 章）:
  生活の道: 広場 → 西の階段（v0.31.0）→ 炉の段 → 南の石段 b → 水音の庭 → 崖沿いの石段 a → 南東の見晴らし台（広場の高さ）→ 広場
  見晴らしの道: 広場 → 崖沿いの石段 c → 暮らしの段 → 崖沿いの石段 d → 灯見の台（西）→ 吊り橋 → 灯見の台（東）→
               東の石段 e → 暮らしの段 → 崖沿いの石段 f → 広場
沢は西の縁（x -46〜-42）を北から南へ流れ、段の境で小滝になる。水面は隣の床より 0.45m 低い（歩いては入れない。柵は立たない）。
"""
import json
import math
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
HUB = os.path.join(ROOT, 'public', 'data', 'hub.json')
OUT = os.path.join(ROOT, 'public', 'data', 'maps', 'hub_village.json')

RISE = 1 / 6
TREAD = 0.3
GARDEN, FORGE, LIVING, LOOKOUT = -10, -3, 8, 22
WATER_DROP = 0.45
BOUNDS = {'minX': -46, 'maxX': 24, 'minZ': -44, 'maxZ': 62}
STREAM = (-46, -42)
PLAYER_R = 0.38

plats = []


def rnd(v, n=4):
    v = round(v, n)
    return 0 if v == 0 else (int(v) if v == int(v) else v)


def plat(x0, x1, z0, z1, h, look):
    assert x1 > x0 and z1 > z0, (x0, x1, z0, z1)
    plats.append({'minX': rnd(x0, 2), 'maxX': rnd(x1, 2), 'minZ': rnd(z0, 2), 'maxZ': rnd(z1, 2), 'h': rnd(h), 'look': look})


def stairs(axis, start, direction, fixed, h0, dh, n):
    """axis 'x': 段は x に沿って並ぶ（幅は z の fixed）。start から direction（+1 / -1）の向きへ 1 段ずつ、高さは h0 + dh * k。終わりの位置を返す"""
    for k in range(1, n + 1):
        a, b = start + direction * TREAD * (k - 1), start + direction * TREAD * k
        lo, hi = min(a, b), max(a, b)
        h = h0 + dh * k
        if axis == 'x':
            plat(lo, hi, fixed[0], fixed[1], h, 'stone')
        else:
            plat(fixed[0], fixed[1], lo, hi, h, 'stone')
    return start + direction * TREAD * n


def subtract(rect, holes):
    """四角 rect（x0, x1, z0, z1）から、穴の四角を除いた所を、重ならない四角に分ける（ます目に切って、横と縦にまとめる）"""
    x0, x1, z0, z1 = rect
    xs = sorted({x0, x1} | {v for h in holes for v in (h[0], h[1]) if x0 < v < x1})
    zs = sorted({z0, z1} | {v for h in holes for v in (h[2], h[3]) if z0 < v < z1})
    free = [[not any(h[0] <= (xs[i] + xs[i + 1]) / 2 <= h[1] and h[2] <= (zs[j] + zs[j + 1]) / 2 <= h[3] for h in holes)
             for j in range(len(zs) - 1)] for i in range(len(xs) - 1)]
    used = [[False] * (len(zs) - 1) for _ in range(len(xs) - 1)]
    out = []
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            if not free[i][j] or used[i][j]:
                continue
            j2 = j
            while j2 + 1 < len(zs) - 1 and free[i][j2 + 1] and not used[i][j2 + 1]:
                j2 += 1
            i2 = i
            while i2 + 1 < len(xs) - 1 and all(free[i2 + 1][k] and not used[i2 + 1][k] for k in range(j, j2 + 1)):
                i2 += 1
            for a in range(i, i2 + 1):
                for k in range(j, j2 + 1):
                    used[a][k] = True
            out.append((xs[i], xs[i2 + 1], zs[j], zs[j2 + 1]))
    return out


def ground_at(x, z):
    h = None
    for p in plats:
        if p['minX'] <= x <= p['maxX'] and p['minZ'] <= z <= p['maxZ'] and (h is None or p['h'] > h):
            h = p['h']
    return 0 if h is None else h


# ---- 水音の庭（-10）と炉の段（-3）----
plat(-42, 24, -44, -17, GARDEN, 'yard')
# 炉の段: v0.31.0 の z -4〜15 を、南の庭の縁（z -17）まで延ばす（設計 #11: 工房・材料置場・半屋外の作業場）
plat(-40, -23.7, -17, 15, FORGE, 'yard')
# 西の階段（v0.31.0 のまま）: 広場から西へ 8 段、踊り場（-1.5m）、8 段で炉の段
stairs('x', -16.8, -1, (7, 10), 0, -RISE, 8)
plat(-21.3, -19.2, 6.25, 10.75, -1.5, 'stone')
stairs('x', -21.3, -1, (7, 10), -1.5, -RISE, 8)

# ---- 生活の道 ----
# a: 広場の南東の見晴らし台（広場の高さ）から、崖沿いに西へ下りて庭へ（30 段・踊り場 -5m・29 段）
plat(18, 24, -21.5, -17, 0, 'stone')
end = stairs('x', 18, -1, (-20, -17), 0, -RISE, 30)
plat(end - 4.5, end, -21.5, -17, -5, 'stone')
stairs('x', end - 4.5, -1, (-20, -17), -5, -RISE, 29)
# b: 炉の段の南の縁から、庭へまっすぐ南へ（21 段・踊り場 -6.5m・20 段）
end = stairs('z', -17, -1, (-30, -27), FORGE, -RISE, 21)
plat(-31.5, -25.5, end - 4.5, end, -6.5, 'stone')
stairs('z', end - 4.5, -1, (-30, -27), -6.5, -RISE, 20)

# ---- 見晴らしの道 ----
# c: 広場の北（依頼板の西）の小さな石の床（広場の高さ）から、暮らしの段の崖沿いに西へ上る（24 段・踊り場 4m・23 段）
C_FOOT = (-6, -3, 17, 20)
plat(*C_FOOT, 0, 'stone')
c_end = stairs('x', -6, -1, (17, 20), 0, RISE, 24)
C_LAND = (c_end - 4.5, c_end, 17, 21.5)
plat(*C_LAND, 4, 'stone')
c_top = stairs('x', C_LAND[0], -1, (17, 20), 4, RISE, 23)
# f: 暮らしの段から、崖沿いに東へ下りて、広場の北東の小さな石の床へ（23 段・踊り場 4m・23 段）
F_TOP = 3.4
f_end = stairs('x', F_TOP, 1, (17, 20), LIVING, -RISE, 23)
F_LAND = (f_end, f_end + 4.5, 17, 21.5)
plat(*F_LAND, 4, 'stone')
f_foot = stairs('x', F_LAND[1], 1, (17, 20), 4, -RISE, 23)
F_FOOT = (f_foot, 24, 17, 20)
plat(*F_FOOT, 0, 'stone')
# 暮らしの段（+8）: c と f の所を除く
for r in subtract((-42, 24, 17, 40), [(c_top, -6, 17, 20), C_LAND, C_FOOT, (F_TOP, f_foot, 17, 20), F_LAND, F_FOOT]):
    plat(*r, LIVING, 'grass')
# d: 暮らしの段の北（小さな石の床。暮らしの段の高さ）から、灯見の台の崖沿いに西へ上る（42 段・踊り場 15m・41 段）
D_FOOT = (-6, -3, 40, 43)
plat(*D_FOOT, LIVING, 'stone')
d_end = stairs('x', -6, -1, (40, 43), LIVING, RISE, 42)
D_LAND = (d_end - 4.5, d_end, 40, 44.5)
plat(*D_LAND, 15, 'stone')
d_top = stairs('x', D_LAND[0], -1, (40, 43), 15, RISE, 41)
# 灯見の台の岩の裂け目（床 15m。どの段からも歩いては入れない）と、それを渡る吊り橋（幅 3m）
CHASM = (-2, 2, 40, 61)
plat(*CHASM, 15, 'rock')
plat(-2, 2, 50, 53, LOOKOUT, 'bridge')
# 灯見の台（+22）: d と裂け目の所を除く
for r in subtract((-42, 24, 40, 62), [(d_top, -6, 40, 43), D_LAND, D_FOOT, CHASM]):
    plat(*r, LOOKOUT, 'grass')
# e: 灯見の台の東の端から、暮らしの段の上に組んだ石段で南へ下り（42 段）、踊り場（15m）で西へ折れて下りる（41 段）
e_end = stairs('z', 40, -1, (21, 24), LOOKOUT, -RISE, 42)
E_LAND = (19.5, 24, e_end - 4.5, e_end)
plat(*E_LAND, 15, 'stone')
stairs('x', 19.5, -1, (E_LAND[2], E_LAND[2] + 3), 15, -RISE, 41)

# ---- 沢: 西の縁を北から南へ。水面は隣の床より 0.45m 低い。段の境で小滝 ----
for z0, z1, floor in ((40, 62, LOOKOUT), (17, 40, LIVING), (-17, 17, 0), (-44, -17, GARDEN)):
    plat(STREAM[0], STREAM[1], z0, z1, floor - WATER_DROP, 'water')

# ---- 当たり（施設 → 建物と飾り → 人 → 小物）。局所の座標（正面が +z）での [x, z, 半径, 床からの高さ] ----
COLLIDE = {
    'workshop': [(0, 0, 3.6, 4.2)], 'shop': [(0, 0, 3.6, 3.6)], 'quest': [(0, 0, 1.5, 2.6)], 'chest': [(0, 0, 2.2, 2.4)],
    'npc': [(0, 0, 0.35, 1.7)],
    'lamp': [(0, 0, 0.6, 3.0)], 'records': [(0, 0, 0.7, 1.6)],
    'shed': [(-1.5, 0, 2.4, 3.8), (1.5, 0, 2.4, 3.8)], 'logs': [(0, 0, 1.1, 1.0)], 'crates': [(0, 0, 0.9, 1.3)], 'tank': [(0, 0, 0.9, 0.9)],
    'mill': [(0, 0, 2.5, 5.0)], 'wash': [(0, 0, 1.2, 1.0)], 'storehouse': [(-1.2, 0, 2.6, 4.6), (1.2, 0, 2.6, 4.6)], 'lift': [(0, 0, 1.3, 10.5)],
    'inn': [(-2.0, 0.4, 3.5, 6.4), (2.0, 0.4, 3.5, 6.4)], 'firewood': [(0, 0, 0.8, 1.4)], 'house': [(-1.3, 0, 2.6, 5.0), (1.3, 0, 2.6, 5.0)],
    'field': [], 'laundry': [(-2.2, 0, 0.15, 2.2), (2.2, 0, 0.15, 2.2)],
    'hall': [(-2.6, 0, 3.9, 6.0), (2.6, 0, 3.9, 6.0), (-4.6, 5.3, 0.2, 3.2), (4.6, 5.3, 0.2, 3.2)], 'survey': [(0, 0, 2.3, 3.2)], 'watch': [(0, 0, 1.7, 10.0)],
    'anvil': [(0, 0, 0.45, 0.9)],
}
PROP_COLLIDE = {'route_lamp_on': (0.25, 2.6), 'route_lamp_off': (0.25, 2.6), 'supply_cart': (1.2, 1.5), 'replaceable_parts': (0.7, 0.8), 'closed_route_sign': (1.1, 1.7)}

problems = []
rocks = []


def collider(name, x, z, yaw, lx, lz, r, h, against_wall=False):
    """局所の (lx, lz) を向き yaw で回して置く（three.js の rotation.y と同じ回し方）。床は中心の地面。円の中が同じ床でなければ止める"""
    cx = x + lx * math.cos(yaw) + lz * math.sin(yaw)
    cz = z - lx * math.sin(yaw) + lz * math.cos(yaw)
    floor = ground_at(cx, cz)
    for k in range(16):
        a = k / 16 * math.pi * 2
        for rr in (r * 0.5, r):
            g = ground_at(cx + math.cos(a) * rr, cz + math.sin(a) * rr)
            if abs(g - floor) > 1e-6 and not (against_wall and g > floor + 2):
                problems.append(f'{name}: 当たりの円（{cx:.2f}, {cz:.2f}、半径 {r}）の中に、別の高さの床（{g}）がある')
                break
        else:
            continue
        break
    if not (BOUNDS['minX'] + r <= cx <= BOUNDS['maxX'] - r and BOUNDS['minZ'] + r <= cz <= BOUNDS['maxZ'] - r):
        problems.append(f'{name}: 当たりの円が、里の外へはみ出す')
    rock = {'x': rnd(cx, 3), 'z': rnd(cz, 3), 'r': r, 'h': rnd(floor + h, 3)}
    if floor != 0:
        rock['y'] = floor
    rocks.append(rock)


def main():
    hub = json.load(open(HUB, encoding='utf-8'))
    for f in hub['facilities']:
        b = f['building']
        for c in COLLIDE[f['kind']]:
            collider(f['id'], b['x'], b['z'], b['yaw'], *c)
    for s in hub.get('scenery', []):
        if s['kind'] not in COLLIDE:
            problems.append(f"scenery {s['id']}: kind {s['kind']} が不明")
            continue
        for c in COLLIDE[s['kind']]:
            collider(s['id'], s['x'], s['z'], s['yaw'], *c, against_wall=s['kind'] == 'lift')
    for n in hub.get('npcs', []):
        collider(n['id'], n['x'], n['z'], 0, *COLLIDE['npc'][0])
    for p in hub.get('props', []):
        if p['art'] not in PROP_COLLIDE:
            problems.append(f"prop {p['id']}: art {p['art']} が不明")
            continue
        r, h = PROP_COLLIDE[p['art']]
        collider(p['id'], p['x'], p['z'], 0, 0, 0, r, h)
    # 段差の検査: どれも里の中。階段の隣り合う段の差は、上りも下りも 1 歩で行ける
    for p in plats:
        if p['minX'] < BOUNDS['minX'] or p['maxX'] > BOUNDS['maxX'] or p['minZ'] < BOUNDS['minZ'] or p['maxZ'] > BOUNDS['maxZ']:
            problems.append(f'platform {p}: 里の外へはみ出す')
    if problems:
        print('\n'.join(problems))
        sys.exit(1)
    out = {
        'schemaVersion': 1,
        'id': 'map.hub.village',
        'name': hub['name'],
        'note': 'tools/gen-hub.py（npm run hub:gen）の出力。手で編集しない。位置の正本は public/data/hub.json。docs/spec.md の 19.2',
        'bounds': BOUNDS,
        'stepUp': 0.35,
        'stepDown': 0.4,
        'spawn': {'x': 0, 'z': -9, 'yaw': 0},
        'camp': {'x': 0, 'z': -15, 'r': 3},
        'monsterSpawn': {'x': 0, 'z': 0, 'yaw': 0},
        'rocks': rocks,
        'platforms': plats,
    }
    lines = ['{']
    for k, v in out.items():
        if k in ('rocks', 'platforms'):
            lines.append(f'  "{k}": [')
            lines.append(',\n'.join('    ' + json.dumps(e, ensure_ascii=False, separators=(', ', ': ')) for e in v))
            lines.append('  ]' + (',' if k != 'platforms' else ''))
        else:
            lines.append(f'  "{k}": ' + json.dumps(v, ensure_ascii=False, separators=(', ', ': ')) + ',')
    lines.append('}')
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    looks = {}
    for p in plats:
        looks[p['look']] = looks.get(p['look'], 0) + 1
    print(f'段差 {len(plats)}（{looks}）、当たり {len(rocks)}')


if __name__ == '__main__':
    main()
