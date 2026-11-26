# フィールド（エリアに分かれた狩場）のデータを作る。使い方: python3 tools/gen-field.py
# 風礫盆地: 野営地 + 10 エリア。エリアは 1 つの座標の中に 240m おきに離して置く（離れているので、別のエリアの相手とは当たらない）。
# エリア 3 は、これまでの狩場（maps/basin_training.json）と同じ形・同じ位置（原点）にしてある。
import json, math, os, random
import numpy as np
from scipy import ndimage
from skimage import measure

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
PITCH = 240.0
legacy = json.load(open(os.path.join(ROOT, 'maps', 'basin_training.json'), encoding='utf8'))

# id, 番号, 名前, 種類, 大型が入れるか, マス（列, 行。行は北が大きい）, 幅, 奥行き
AREAS = [
    ('camp', 0, '野営地', 'camp', False, (0, 0), 36, 28),
    ('a1', 1, '礫の坂', 'path', False, (1, 0), 56, 44),
    ('a2', 2, '風の草原', 'hunt', True, (0, 1), 84, 64),
    ('a3', 3, '岩原', 'hunt', True, (1, 1), 80, 60),
    ('a4', 4, '立ち岩の丘', 'hunt', True, (0, 2), 72, 60),
    ('a5', 5, '涸れ沢', 'path', False, (2, 0), 60, 44),
    ('a6', 6, '晶脈の露頭', 'hunt', True, (2, 1), 88, 66),
    ('a7', 7, '北の台地', 'hunt', True, (1, 2), 84, 62),
    ('a8', 8, '崩れ谷', 'path', False, (3, 0), 52, 48),
    ('a9', 9, '西の礫原', 'hunt', True, (3, 1), 80, 64),
    ('a10', 10, '晶の窪地', 'nest', True, (2, 2), 70, 58),
]
EDGES = [('camp', 'a1'), ('a1', 'a5'), ('a5', 'a8'), ('a1', 'a3'), ('a5', 'a6'), ('a8', 'a9'), ('a2', 'a3'), ('a3', 'a6'), ('a6', 'a9'),
         ('a2', 'a4'), ('a3', 'a7'), ('a6', 'a10'), ('a4', 'a7'), ('a7', 'a10')]
ORIGIN = (1, 1)  # エリア 3 のマスを原点に置く
EXIT_R, ARRIVE, ARRIVE_LARGE, INSET = 3.2, 8.0, 15.0, 2.0

info = {a[0]: a for a in AREAS}
def center(aid):
    c, r = info[aid][5]
    return ((c - ORIGIN[0]) * PITCH, (r - ORIGIN[1]) * PITCH)
def r1(v): return round(v, 2)

# ---- 自然な形のエリア（v0.20.0。docs/spec.md の 18.4）----
# エリアの形は、骨組み（中心と半径を持つ点を、線でつないだもの）のまわりの「膨らみ」で決める。
# 骨組みの線ごとに、半径を線に沿って変えた太い筒を考え、どれかの筒の中なら歩ける。そこへ、ゆるい起伏の雑音を足し、
# なめらかにしてから、境目の線（外周）を取り出す。出口は、骨組みの端（口）の先に開ける。
# 点の座標は、エリアの中心からの (x, z 北, 半径)。口の向きは、隣のエリアの方角（E = +X / W = -X / N / S）。
# v0.42.0（D-133）: 上から見ると +X は西（北を上にした地図の左）。E/W の印と、マス目の列（+X ほど大きい）は、これまでどおり +X / -X の意味。
# 名前だけを上から見た向きに合わせた（エリア 9 は、+X の端なので「西の礫原」。これまでは「東の礫原」）。
SKELETON = {
    # 野営地: 小さな林間の空き地
    'camp': dict(size='narrow', nodes=dict(c=(0, 0, 13), w=(-8, 3, 9), mE=(22, 0, 6.5)), segs=[('c', 'w'), ('c', 'mE')], noise=1.0),
    # 1 礫の坂: T の字の狭い谷（幅 13〜17m）
    'a1': dict(size='narrow', nodes=dict(mW=(-34, 0, 6.5), w=(-20, 3, 7.5), c=(-4, 1, 8.5), e=(14, -4, 7), mE=(34, 0, 6.5), n=(0, 14, 6.5), mN=(2, 30, 6.5)),
               segs=[('mW', 'w'), ('w', 'c'), ('c', 'e'), ('e', 'mE'), ('c', 'n'), ('n', 'mN')], noise=0.8),
    # 2 風の草原: 広い原（約 105 × 95m）。戦いやすい
    'a2': dict(size='wide', nodes=dict(c=(0, 0, 34), sw=(-22, -18, 22), ne=(20, 20, 24), se=(24, -20, 18), nw=(-24, 18, 16), mE=(52, 0, 9), mN=(0, 50, 9)),
               segs=[('c', 'sw'), ('c', 'ne'), ('c', 'se'), ('c', 'nw'), ('c', 'mE'), ('c', 'mN')], noise=1.6),
    # 3 岩原: 岩の位置は、これまでの狩場のまま。出口も同じ位置（口の先が、これまでの外周の線）
    'a3': dict(size='medium', nodes=dict(c=(0, 0, 24), w=(-20, 2, 19), e=(20, -2, 16), n=(-4, 14, 14), s=(4, -14, 14), se=(18, -14, 10), sw=(-18, -12, 10), ne=(10, 16, 11),
                                       mS=(0, -22, 8), mW=(-32, 0, 8), mE=(32, 0, 8), mN=(0, 22, 8)),
               segs=[('c', 'w'), ('c', 'e'), ('c', 'n'), ('c', 's'), ('e', 'se'), ('w', 'sw'), ('n', 'ne'), ('s', 'mS'), ('w', 'mW'), ('e', 'mE'), ('n', 'mN')], noise=1.2),
    # 4 立ち岩の丘: 2 つの丘が、幅 16m ほどのくびれでつながる
    'a4': dict(size='medium', nodes=dict(a=(-14, -8, 17), m=(1, 2, 8), b=(16, 12, 18), mS=(-14, -34, 8), mE=(42, 12, 8)),
               segs=[('a', 'm'), ('m', 'b'), ('a', 'mS'), ('b', 'mE')], noise=1.2),
    # 5 涸れ沢: 曲がりくねった、狭い沢（幅 12〜16m）
    'a5': dict(size='narrow', nodes=dict(mW=(-34, 2, 6), w=(-20, -4, 7), c=(-4, 2, 8), e=(14, 8, 6.5), mE=(34, 2, 6), n=(-2, 16, 6), mN=(0, 30, 6.5)),
               segs=[('mW', 'w'), ('w', 'c'), ('c', 'e'), ('e', 'mE'), ('c', 'n'), ('n', 'mN')], noise=0.8),
    # 6 晶脈の露頭: 広い原（約 105 × 95m）
    'a6': dict(size='wide', nodes=dict(c=(0, 0, 32), w=(-22, 6, 18), e=(22, -6, 20), n=(6, 22, 16), s=(-6, -22, 16), ne=(24, 16, 12),
                                     mS=(0, -44, 9), mW=(-50, 4, 9), mE=(52, -2, 9), mN=(4, 46, 9)),
               segs=[('c', 'w'), ('c', 'e'), ('c', 'n'), ('c', 's'), ('c', 'ne'), ('s', 'mS'), ('w', 'mW'), ('e', 'mE'), ('n', 'mN')], noise=1.6),
    # 7 北の台地: 広い原（約 110 × 90m）
    'a7': dict(size='wide', nodes=dict(c=(0, 0, 33), w=(-24, -4, 20), e=(24, 4, 20), nw=(-14, 20, 16), se=(12, -20, 14), mS=(4, -44, 9), mW=(-52, -2, 9), mE=(52, 4, 9)),
               segs=[('c', 'w'), ('c', 'e'), ('c', 'nw'), ('c', 'se'), ('se', 'mS'), ('w', 'mW'), ('e', 'mE')], noise=1.6),
    # 8 崩れ谷: L の字の、狭い谷（幅 12〜16m）
    'a8': dict(size='narrow', nodes=dict(mW=(-30, -2, 6), w=(-14, 2, 7.5), c=(-2, 6, 8), n=(6, 18, 6), mN=(4, 30, 6)),
               segs=[('mW', 'w'), ('w', 'c'), ('c', 'n'), ('n', 'mN')], noise=0.8),
    # 9 西の礫原: そら豆の形の原（約 85 × 75m。v0.41.0 までの名前は「東の礫原」）
    'a9': dict(size='medium', nodes=dict(c=(0, 0, 22), a=(-16, 10, 16), b=(16, -8, 18), d=(14, 16, 12), mS=(8, -36, 8), mW=(-44, 8, 8)),
               segs=[('c', 'a'), ('c', 'b'), ('c', 'd'), ('b', 'mS'), ('a', 'mW')], noise=1.4),
    # 10 晶の窪地: 丸い窪地（巣）
    'a10': dict(size='medium', nodes=dict(c=(0, 0, 27), l=(8, 10, 14), mS=(0, -36, 8), mW=(-38, 0, 8)),
                segs=[('c', 'l'), ('c', 'mS'), ('c', 'mW')], noise=1.2),
}
GRID_M = 0.5        # 形を作る時のます目（m）
RESAMPLE_M = 1.6    # 外周の点の間隔（m）
EXIT_IN = 2.0       # 出口（入ると移る円の中心）を、口の先から内側へ
DIRS = {'E': (1, 0), 'W': (-1, 0), 'N': (0, 1), 'S': (0, -1)}

def seg_dist(px, pz, ax, az, bx, bz):
    ex, ez = bx - ax, bz - az
    l2 = ex * ex + ez * ez
    t = np.clip(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1) if l2 > 0 else np.zeros_like(px)
    return np.hypot(px - (ax + ex * t), pz - (az + ez * t)), t

def make_shape(aid, sk, cx, cz):
    """骨組みから外周を作る。返すのは (外周の点, 膨らみの場, ます目の原点)"""
    nodes = sk['nodes']
    xs = [x for x, z, r in nodes.values()]; zs = [z for x, z, r in nodes.values()]
    pad = max(r for _, _, r in nodes.values()) + 10
    x0, x1 = min(xs) - pad, max(xs) + pad
    z0, z1 = min(zs) - pad, max(zs) + pad
    gx = np.arange(x0, x1, GRID_M); gz = np.arange(z0, z1, GRID_M)
    X, Z = np.meshgrid(gx, gz)
    f = np.full(X.shape, -1e9)
    for a, b in sk['segs']:
        ax, az, ar = nodes[a]; bx, bz, br = nodes[b]
        d, t = seg_dist(X, Z, ax, az, bx, bz)
        f = np.maximum(f, ar + (br - ar) * t - d)
    # ゆるい起伏（14m ほどの波）と、細かな起伏（4m ほど）。口のまわりは、出口の形を崩さないように弱める
    rng = np.random.default_rng(5000 + info[aid][1])
    def wave(spacing, amp):
        n = rng.normal(size=(int(np.ceil((z1 - z0) / spacing)) + 3, int(np.ceil((x1 - x0) / spacing)) + 3))
        up = ndimage.zoom(n, spacing / GRID_M, order=3)[:X.shape[0], :X.shape[1]]
        return up / (up.std() + 1e-9) * amp
    noise = wave(14, sk['noise']) + wave(4, sk['noise'] * 0.35)
    calm = np.ones_like(f)
    for k, (mx, mz, mr) in nodes.items():
        if k.startswith('m'):
            calm = np.minimum(calm, np.clip((np.hypot(X - mx, Z - mz) - mr) / 10, 0, 1))
    field = ndimage.gaussian_filter(f + noise * calm, 1.5 / GRID_M)
    cs = measure.find_contours(field, 0.0)
    c = max(cs, key=len)
    pts = np.column_stack([x0 + c[:, 1] * GRID_M, z0 + c[:, 0] * GRID_M])
    # 間隔をそろえる
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    k = max(12, int(L / RESAMPLE_M))
    u = np.linspace(0, L, k, endpoint=False)
    rs = np.column_stack([np.interp(u, s, pts[:, 0]), np.interp(u, s, pts[:, 1])])
    # 向き: x → z の向きに回る（面積が正）
    area2 = np.sum(rs[:, 0] * np.roll(rs[:, 1], -1) - np.roll(rs[:, 0], -1) * rs[:, 1])
    if area2 < 0: rs = rs[::-1]
    return rs, field, (x0, z0)

def field_at(field, origin, x, z):
    x0, z0 = origin
    return ndimage.map_coordinates(field, [[(z - z0) / GRID_M], [(x - x0) / GRID_M]], order=1, mode='nearest')[0]

def inside_poly(poly, x, z):
    c = False
    n = len(poly)
    for i in range(n):
        xi, zi = poly[i]; xj, zj = poly[i - 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi: c = not c
    return c

def wall_dist(poly, x, z):
    """外周までの距離（中なら正）"""
    a = poly; b = np.roll(poly, -1, axis=0)
    ex, ez = b[:, 0] - a[:, 0], b[:, 1] - a[:, 1]
    t = np.clip(((x - a[:, 0]) * ex + (z - a[:, 1]) * ez) / (ex * ex + ez * ez), 0, 1)
    d = np.hypot(x - (a[:, 0] + ex * t), z - (a[:, 1] + ez * t)).min()
    return d if inside_poly(poly, x, z) else -d

areas = {}
shapes = {}
for aid, no, name, kind, large, grid, w, d in AREAS:
    cx, cz = center(aid)
    sk = SKELETON[aid]
    poly, fld, org = make_shape(aid, sk, 0.0, 0.0)
    poly = poly + np.array([cx, cz])
    shapes[aid] = (poly, fld, (org[0] + cx, org[1] + cz))
    ncx, ncz, _ = sk['nodes'].get('c', next(iter(sk['nodes'].values())))
    areas[aid] = dict(id=aid, no=no, name=name, kind=kind, large=large, grid=list(grid), size=sk['size'],
                      bounds=dict(minX=r1(poly[:, 0].min()), maxX=r1(poly[:, 0].max()), minZ=r1(poly[:, 1].min()), maxZ=r1(poly[:, 1].max())),
                      center=dict(x=r1(cx + ncx), z=r1(cz + ncz)),
                      shape=[[r1(x), r1(z)] for x, z in poly],
                      nav=[[r1(cx + x), r1(cz + z)] for x, z, r in sk['nodes'].values()],
                      stepUp=0.35, rocks=[], platforms=[], exits=[])

def mouth(aid, other):
    """aid の、other へ向かう口: 出口の位置（口の先から EXIT_IN 内側）と、外向きの向き"""
    (c0, r0), (c1, r1_) = info[aid][5], info[other][5]
    dc, dr = c1 - c0, r1_ - r0
    assert abs(dc) + abs(dr) == 1, (aid, other)
    key = 'E' if dc > 0 else 'W' if dc < 0 else 'N' if dr > 0 else 'S'
    ux, uz = DIRS[key]
    cx, cz = center(aid)
    mx, mz, mr = SKELETON[aid]['nodes']['m' + key]
    poly, fld, org = shapes[aid]
    if aid == 'a3':
        # エリア 3 の出口は、これまでの狩場と同じ位置（これまでの外周 ±40 / ±30 の 2m 内側）
        b = legacy['bounds']
        tip = (b['maxX'] if ux > 0 else b['minX'] if ux < 0 else 0.0, b['maxZ'] if uz > 0 else b['minZ'] if uz < 0 else 0.0)
        assert abs(field_at(fld, org, tip[0] - ux * 0.3, tip[1] - uz * 0.3)) < 1.5, ('a3 の口の先が、これまでの外周からずれている', key)
        return (tip[0] - ux * EXIT_IN, tip[1] - uz * EXIT_IN), (ux, uz)
    # 口の点から外へ、外周を越えるまで進む
    t = 0.0
    while field_at(fld, org, cx + mx + ux * t, cz + mz + uz * t) > 0: t += 0.05
    tip = (cx + mx + ux * t, cz + mz + uz * t)
    return (tip[0] - ux * EXIT_IN, tip[1] - uz * EXIT_IN), (ux, uz)

for a, b in EDGES:
    for src, dst in ((a, b), (b, a)):
        (x, z), _ = mouth(src, dst)
        (tx, tz), (ux, uz) = mouth(dst, src)
        nx, nz = -ux, -uz  # 行き先の口から、内向き
        yaw = math.atan2(nx, nz)
        e = dict(to=dst, x=r1(x), z=r1(z), r=EXIT_R, arrive=dict(x=r1(tx + nx * ARRIVE), z=r1(tz + nz * ARRIVE), yaw=round(yaw, 4)))
        if info[src][4] and info[dst][4]:
            e['large'] = True
            e['arriveLarge'] = dict(x=r1(tx + nx * ARRIVE_LARGE), z=r1(tz + nz * ARRIVE_LARGE), yaw=round(yaw, 4))
        areas[src]['exits'].append(e)

# 岩と段差。エリア 3 の岩は、これまでの狩場のまま（段差は、ほかのエリアと同じように作る）
areas['a3']['rocks'] = [dict(o) for o in legacy['rocks']]
# エリア 3 は岩の位置を変えられないので、着く場所の方を、岩を避けて横へずらす
def nudge(p, margin):
    horiz = abs(math.sin(p['yaw'])) > 0.5  # ±X の向きに入ってくるなら、±Z へずらす
    for off in (0, -2, 2, -4, 4, -6, 6, -8, 8):
        x, z = (p['x'], p['z'] + off) if horiz else (p['x'] + off, p['z'])
        if all(math.hypot(x - o['x'], z - o['z']) > o['r'] + margin for o in legacy['rocks']) and wall_dist(shapes['a3'][0], x, z) > margin + 1:
            p['x'], p['z'] = r1(x), r1(z)
            return
    raise SystemExit('着く場所を空けられない')
for other in areas.values():
    for e in other['exits']:
        if e['to'] == 'a3':
            nudge(e['arrive'], 2.0)
            if 'arriveLarge' in e: nudge(e['arriveLarge'], 4.5)
for o in legacy['rocks']:
    assert wall_dist(shapes['a3'][0], o['x'], o['z']) > o['r'] + 2.5, ('a3 の岩が外周に近い', o)
for p in (legacy['spawn'], legacy['monsterSpawn']):
    assert wall_dist(shapes['a3'][0], p['x'], p['z']) > 4, ('a3 の出発地点が外周に近い', p)

# 登攀の棚を置くエリアと、棚の高さ（v0.44.0。設計の relative_rise_m）
CLIMB_SHELVES = {'a4': 3.0, 'a9': 3.0}

def keep_zones(aid, a):
    cx, cz = a['center']['x'], a['center']['z']
    keep = [(e['x'], e['z'], 11.0) for e in a['exits']] + [(cx, cz, 9.0)]
    for other in areas.values():
        for e in other['exits']:
            if e['to'] == aid:
                keep.append((e['arrive']['x'], e['arrive']['z'], 6.0))
                if 'arriveLarge' in e: keep.append((e['arriveLarge']['x'], e['arriveLarge']['z'], 9.0))
    return keep

def near_arm(aid, x, z, pad):
    """口へ向かう骨組みの線（出口への通り道）に近い"""
    cx, cz = center(aid)
    nodes = SKELETON[aid]['nodes']
    for a_, b_ in SKELETON[aid]['segs']:
        if not (a_.startswith('m') or b_.startswith('m')): continue
        ax, az, _ = nodes[a_]; bx, bz, _ = nodes[b_]
        d, _t = seg_dist(np.array(x - cx), np.array(z - cz), ax, az, bx, bz)
        if float(d) < pad: return True
    return False

for aid, a in areas.items():
    if aid == 'camp':
        continue
    rnd = random.Random(1000 + a['no'])
    poly = shapes[aid][0]
    b = a['bounds']
    keep = keep_zones(aid, a)
    area_m2 = abs(np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])) / 2
    if aid != 'a3':
        n = max(4, int(area_m2 / 520)) + (3 if a['kind'] == 'path' else 0)
        tries = 0
        while len(a['rocks']) < n and tries < 2000:
            tries += 1
            r = (1.0 + rnd.random() * 1.2) if a['size'] == 'narrow' else (1.4 + rnd.random() * 1.5)
            x = b['minX'] + rnd.random() * (b['maxX'] - b['minX'])
            z = b['minZ'] + rnd.random() * (b['maxZ'] - b['minZ'])
            if wall_dist(poly, x, z) < r + 3.0: continue
            if any(math.hypot(x - kx, z - kz) < kr + r for kx, kz, kr in keep): continue
            if any(math.hypot(x - o['x'], z - o['z']) < r + o['r'] + 5.5 for o in a['rocks']): continue
            if near_arm(aid, x, z, r + 3.5): continue
            a['rocks'].append(dict(x=r1(x), z=r1(z), r=r1(r), h=r1(r * (1.1 + rnd.random() * 0.5))))
    # 低い段を 1 つ（狩りのエリアと巣。外周の近くの、出口から離れた所）
    if a['kind'] in ('hunt', 'nest'):
        for k in range(4000):
            shrink = 1 - 0.4 * k / 4000  # 置けない時は、少しずつ小さくする
            pw, pd = (12 + rnd.random() * 6) * shrink, (9 + rnd.random() * 5) * shrink
            x0 = b['minX'] + rnd.random() * (b['maxX'] - b['minX'] - pw)
            z0 = b['minZ'] + rnd.random() * (b['maxZ'] - b['minZ'] - pd)
            corners = [(x0, z0), (x0 + pw, z0), (x0, z0 + pd), (x0 + pw, z0 + pd)]
            if any(wall_dist(poly, x, z) < 1.5 for x, z in corners): continue
            mx, mz = x0 + pw / 2, z0 + pd / 2
            # 外周の近く（どこかの角が外周から 6m 以内）で、出口・中心・着く場所から離れる
            if min(wall_dist(poly, x, z) for x, z in corners) > 6: continue
            if any(math.hypot(mx - kx, mz - kz) < kr + max(pw, pd) / 2 + 2 for kx, kz, kr in keep): continue
            if near_arm(aid, mx, mz, max(pw, pd) / 2 + 3): continue
            plat = dict(minX=r1(x0), maxX=r1(x0 + pw), minZ=r1(z0), maxZ=r1(z0 + pd), h=0.3)
            # エリア 3 の岩（これまでの狩場のまま）は、動かさない。重なる所には置かない
            if aid == 'a3' and any(plat['minX'] - o['r'] - 1 < o['x'] < plat['maxX'] + o['r'] + 1 and plat['minZ'] - o['r'] - 1 < o['z'] < plat['maxZ'] + o['r'] + 1 for o in a['rocks']): continue
            a['platforms'].append(plat)
            a['rocks'] = [o for o in a['rocks'] if not (plat['minX'] - o['r'] - 1 < o['x'] < plat['maxX'] + o['r'] + 1 and plat['minZ'] - o['r'] - 1 < o['z'] < plat['maxZ'] + o['r'] + 1)]
            break
        else:
            print(f'{aid}: 段を置ける所が無い（段なし）')
    # 登攀の棚（v0.44.0。#19 の H07・F02 の最初の一切れ。ChatGPT の field_blueprints の a4_climb_01・a9_climb_01: 3m 上の採取棚へ、壁を登る）。
    # 外周に寄せた 9 × 6m の棚（高さ 3m）。エリアの中心を向いた辺が登れる壁で、その前（1.2m）が登り口。乱数は使わず、ます目を順に調べて、いちばん良い所
    if aid in CLIMB_SHELVES:
        cx, cz = a['center']['x'], a['center']['z']
        best = None
        for pw, pd in ((9.0, 6.0), (6.0, 9.0)):
            for x0 in np.arange(b['minX'], b['maxX'] - pw, 1.0):
                for z0 in np.arange(b['minZ'], b['maxZ'] - pd, 1.0):
                    x0, z0 = float(x0), float(z0)
                    corners = [(x0, z0), (x0 + pw, z0), (x0, z0 + pd), (x0 + pw, z0 + pd)]
                    wd = [wall_dist(poly, x, z) for x, z in corners]
                    if min(wd) < 0.8 or min(wd) > 4: continue
                    mx, mz = x0 + pw / 2, z0 + pd / 2
                    if any(math.hypot(mx - kx, mz - kz) < kr + max(pw, pd) / 2 + 2 for kx, kz, kr in keep): continue
                    if near_arm(aid, mx, mz, max(pw, pd) / 2 + 2): continue
                    if any(x0 - o['r'] - 1 < o['x'] < x0 + pw + o['r'] + 1 and z0 - o['r'] - 1 < o['z'] < z0 + pd + o['r'] + 1 for o in a['rocks']): continue
                    if any(x0 - 2 < q['maxX'] and q['minX'] < x0 + pw + 2 and z0 - 2 < q['maxZ'] and q['minZ'] < z0 + pd + 2 for q in a['platforms']): continue
                    # 中心を向いた辺（外向きの向きが、中心への向きにいちばん近い辺）
                    sides = [((x0, mz), (-1.0, 0.0)), ((x0 + pw, mz), (1.0, 0.0)), ((mx, z0), (0.0, -1.0)), ((mx, z0 + pd), (0.0, 1.0))]
                    tx, tz = cx - mx, cz - mz
                    (fx_, fz_), (nx_, nz_) = max(sides, key=lambda s_: s_[1][0] * tx + s_[1][1] * tz)
                    bx, bz = fx_ + nx_ * 1.2, fz_ + nz_ * 1.2
                    if wall_dist(poly, bx, bz) < 2.5: continue
                    if any(math.hypot(bx - o['x'], bz - o['z']) < o['r'] + 1.5 for o in a['rocks']): continue
                    # 登る壁の両脇の角も、外周から離す（壁の前を歩いて回り込める）
                    score = min(wd) + 0.02 * math.hypot(bx - cx, bz - cz)
                    if best is None or score < best[0]:
                        best = (score, dict(minX=r1(x0), maxX=r1(x0 + pw), minZ=r1(z0), maxZ=r1(z0 + pd), h=CLIMB_SHELVES[aid]), (fx_, fz_), (nx_, nz_), (bx, bz))
        assert best, f'{aid}: 登攀の棚を置ける所が無い'
        _, shelf, (fx_, fz_), (nx_, nz_), (bx, bz) = best
        a['platforms'].append(shelf)
        a['climbs'] = [dict(id=f'{aid}_climb_01', x=r1(bx), z=r1(bz), yaw=round(math.atan2(-nx_, -nz_), 4), width=2.4, faceDist=1.2, top=shelf['h'],
                            exit=dict(x=r1(fx_ - nx_ * 1.6), z=r1(fz_ - nz_ * 1.6)))]

ccx, ccz = center('camp')
field = dict(
    schemaVersion=1, id='field.basin', name='風礫盆地',
    note='フィールド = エリアに分かれた狩場（D-066）。野営地と 10 エリア。座標は 1 つの空間で、エリアを 240m おきに離して置いてある（別のエリアの相手とは、距離が遠いので関わらない）。exits へ入ると、行き先のエリアの arrive へ移る。large の付いた出口は、大型モンスターも通る（arriveLarge）。エリアは自然な形（v0.20.0。shape = 歩ける範囲の外周、nav = 道しるべ、center = 中心。骨組みのまわりの膨らみから作る）。エリア 3 の岩と出口は、maps/basin_training.json と同じ位置。形・岩・段差は tools/gen-field.py が種から作った仮の配置で、設定図は無い。',
    legacyMapId=legacy['id'], legacyAreaId='a3',
    start=dict(areaId='camp', x=r1(ccx - 4), z=r1(ccz), yaw=round(math.pi / 2, 4)),
    camp=dict(x=r1(ccx - 9), z=r1(ccz + 4), r=3.5),
    timeLimitScale=2,
    roam=dict(note='大型の移動と休息。stayTicks の間エリアに居て、次のエリアへ出ていく。出ていく速さ leaveSpeed（弱っていれば limpLeaveSpeed。m/s）は、狩人が走っても追いつけない速さ（v0.20.0）。体力が limpHpRatio 以下になると、巣（nest）へ向かい、sleepTicks の間眠って、体力を sleepHealCap まで戻す。攻撃されると起きる。机上の値',
              stayTicks=[5400, 9000], leaveSpeed=9.0, limpLeaveSpeed=7.6, leaveTurnScale=4, limpSpeedScale=0.7, limpHpRatio=0.25, sleepTicks=3600, sleepHealPerSec=0.004, sleepHealCap=0.4, wakeStayTicks=1800, wanderSpeedScale=0.55, wanderIdleTicks=[240, 540], wanderInset=10, loseSightTicks=600),
    # 大型 11 種（v0.17.0）は、本来の狩場が無いので、ここを借りる（巡り方は tools/gen-monsters.py の route と同じ）
    routes={'monster.galdros': dict(start='a3', roam=['a3', 'a7', 'a4', 'a2'], nest='a10'),
            'monster.selvark': dict(start='a2', roam=['a2', 'a4', 'a3'], nest='a10'), 'monster.numeradon': dict(start='a4', roam=['a4', 'a7', 'a3'], nest='a10'), 'monster.bornakel': dict(start='a7', roam=['a7', 'a4', 'a2'], nest='a10'), 'monster.ashreia': dict(start='a6', roam=['a6', 'a9', 'a3'], nest='a10'), 'monster.lumisca': dict(start='a9', roam=['a9', 'a6', 'a3'], nest='a10'), 'monster.orglass': dict(start='a3', roam=['a3', 'a6', 'a9'], nest='a10'), 'monster.tengaro': dict(start='a7', roam=['a7', 'a3', 'a6'], nest='a10'), 'monster.verito': dict(start='a4', roam=['a4', 'a2', 'a3'], nest='a10'), 'monster.razmer': dict(start='a2', roam=['a2', 'a3', 'a7'], nest='a10'), 'monster.kirisave': dict(start='a6', roam=['a6', 'a3', 'a2'], nest='a10'), 'monster.velgait': dict(start='a9', roam=['a9', 'a6', 'a7'], nest='a10')},
    # 幼体の群れの住みか（v0.18.0。docs/spec.md の 23 章）。areas の順に、ときどき移り住む。
    # native = この狩場に住む群れ（いつも居る）。そうでない群れは、親か自分が依頼の標的の時だけ出る（本来の狩場が、まだ無い種）。
    # 大型が入れない通り道（1・5・8）にも住む（小さな体の逃げ場）。
    herds=[dict(monsterId='monster.kordopil', areas=['a1', 'a2'], native=True), dict(monsterId='monster.kordopil', areas=['a7', 'a4'], native=True),
           dict(monsterId='monster.palseit', areas=['a5', 'a6'], native=True), dict(monsterId='monster.palseit', areas=['a4', 'a2'], native=True),
           dict(monsterId='monster.numaporon', areas=['a7', 'a4'], native=False), dict(monsterId='monster.chilumicana', areas=['a9', 'a6'], native=False),
           dict(monsterId='monster.kohalgis', areas=['a6', 'a9'], native=False), dict(monsterId='monster.mitogaron', areas=['a7', 'a3'], native=False),
           dict(monsterId='monster.yurtepica', areas=['a8', 'a5'], native=False), dict(monsterId='monster.hinasalv', areas=['a6', 'a3'], native=False)],
    areas=[areas[a[0]] for a in AREAS],
)
def dump(o): return json.dumps(o, ensure_ascii=False)
out = ['{']
for k in ('schemaVersion', 'id', 'name', 'note', 'legacyMapId', 'legacyAreaId', 'start', 'camp', 'timeLimitScale', 'roam', 'routes'):
    out.append(f'  {json.dumps(k)}: {dump(field[k])},')
out.append('  "herds": [\n    ' + ',\n    '.join(dump(h) for h in field['herds']) + '\n  ],')
out.append('  "areas": [')
for i, a in enumerate(field['areas']):
    out.append('    {')
    keys = [k for k in a if k not in ('rocks', 'platforms', 'exits', 'shape', 'nav')]
    out.append('      ' + ', '.join(f'{json.dumps(k)}: {dump(a[k])}' for k in keys) + ',')
    out.append(f'      "nav": {dump(a["nav"])},')
    out.append(f'      "shape": {dump(a["shape"])},')
    for k in ('exits', 'rocks', 'platforms'):
        out.append(f'      {json.dumps(k)}: [' + ('\n        ' + ',\n        '.join(dump(x) for x in a[k]) + '\n      ' if a[k] else '') + ']' + (',' if k != 'platforms' else ''))
    out.append('    }' + (',' if i < len(field['areas']) - 1 else ''))
out += ['  ]', '}']
open(os.path.join(ROOT, 'fields', 'basin.json'), 'w', encoding='utf8').write('\n'.join(out) + '\n')
print('areas', len(field['areas']), 'rocks', [len(a['rocks']) for a in field['areas']], 'exits', sum(len(a['exits']) for a in field['areas']))
