# フィールド（エリアに分かれた狩場）のデータを作る。使い方: python3 tools/gen-field.py
# 風礫盆地: 野営地 + 10 エリア。エリアは 1 つの座標の中に 240m おきに離して置く（離れているので、別のエリアの相手とは当たらない）。
# エリア 3 は、これまでの狩場（maps/basin_training.json）と同じ形・同じ位置（原点）にしてある。
import json, math, os, random

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
    ('a9', 9, '東の礫原', 'hunt', True, (3, 1), 80, 64),
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

areas = {}
for aid, no, name, kind, large, grid, w, d in AREAS:
    cx, cz = center(aid)
    areas[aid] = dict(id=aid, no=no, name=name, kind=kind, large=large, grid=list(grid),
                      bounds=dict(minX=cx - w / 2, maxX=cx + w / 2, minZ=cz - d / 2, maxZ=cz + d / 2), stepUp=0.35, rocks=[], platforms=[], exits=[])

def exit_point(aid, other):
    """aid の、other へ向かう出口の位置と、内向きの向き"""
    (c0, r0), (c1, r1_) = info[aid][5], info[other][5]
    b = areas[aid]['bounds']
    cx, cz = center(aid)
    dc, dr = c1 - c0, r1_ - r0
    assert abs(dc) + abs(dr) == 1, (aid, other)
    if dc:  # 東西
        x = b['maxX'] - INSET if dc > 0 else b['minX'] + INSET
        return (x, cz), (-dc, 0)
    z = b['maxZ'] - INSET if dr > 0 else b['minZ'] + INSET
    return (cx, z), (0, -dr)

for a, b in EDGES:
    for src, dst in ((a, b), (b, a)):
        (x, z), _ = exit_point(src, dst)
        (tx, tz), (nx, nz) = exit_point(dst, src)
        yaw = math.atan2(nx, nz)
        e = dict(to=dst, x=r1(x), z=r1(z), r=EXIT_R, arrive=dict(x=r1(tx + nx * ARRIVE), z=r1(tz + nz * ARRIVE), yaw=round(yaw, 4)))
        if info[src][4] and info[dst][4]:
            e['large'] = True
            e['arriveLarge'] = dict(x=r1(tx + nx * ARRIVE_LARGE), z=r1(tz + nz * ARRIVE_LARGE), yaw=round(yaw, 4))
        areas[src]['exits'].append(e)

# 岩と段差。エリア 3 は、これまでの狩場のまま
areas['a3']['rocks'] = legacy['rocks']
areas['a3']['platforms'] = legacy['platforms']
assert areas['a3']['bounds'] == legacy['bounds'], (areas['a3']['bounds'], legacy['bounds'])
# エリア 3 は岩の位置を変えられないので、着く場所の方を、岩を避けて横へずらす
def nudge(p, margin):
    horiz = abs(math.sin(p['yaw'])) > 0.5  # 東西に入ってくるなら、南北へずらす
    for off in (0, -2, 2, -4, 4, -6, 6, -8, 8):
        x, z = (p['x'], p['z'] + off) if horiz else (p['x'] + off, p['z'])
        if all(math.hypot(x - o['x'], z - o['z']) > o['r'] + margin for o in legacy['rocks']):
            p['x'], p['z'] = r1(x), r1(z)
            return
    raise SystemExit('着く場所を空けられない')
for other in areas.values():
    for e in other['exits']:
        if e['to'] == 'a3':
            nudge(e['arrive'], 2.0)
            if 'arriveLarge' in e: nudge(e['arriveLarge'], 4.5)
for aid, a in areas.items():
    if aid in ('a3', 'camp'):
        continue
    rnd = random.Random(1000 + a['no'])
    b = a['bounds']
    w, d = b['maxX'] - b['minX'], b['maxZ'] - b['minZ']
    cx, cz = center(aid)
    keep = [(e['x'], e['z'], 11.0) for e in a['exits']] + [(cx, cz, 9.0)]
    # 出口から入ってきた所（人は 8m、大型は 15m 内側）も空けておく
    for other in areas.values():
        for e in other['exits']:
            if e['to'] == aid:
                keep.append((e['arrive']['x'], e['arrive']['z'], 6.0))
                if 'arriveLarge' in e: keep.append((e['arriveLarge']['x'], e['arriveLarge']['z'], 9.0))
    n = max(4, int(w * d / 520)) + (3 if a['kind'] == 'path' else 0)
    tries = 0
    while len(a['rocks']) < n and tries < 600:
        tries += 1
        r = 1.4 + rnd.random() * 1.5
        x = b['minX'] + 5 + rnd.random() * (w - 10)
        z = b['minZ'] + 5 + rnd.random() * (d - 10)
        if any(math.hypot(x - kx, z - kz) < kr + r for kx, kz, kr in keep): continue
        if any(math.hypot(x - o['x'], z - o['z']) < r + o['r'] + 5.5 for o in a['rocks']): continue
        a['rocks'].append(dict(x=r1(x), z=r1(z), r=r1(r), h=r1(r * (1.1 + rnd.random() * 0.5))))
    # 角に、低い段を 1 つ（出口の無い角）
    if a['kind'] != 'path':
        sx, sz = rnd.choice([(1, 1), (-1, 1), (1, -1), (-1, -1)])
        pw, pd = 14 + rnd.random() * 6, 11 + rnd.random() * 5
        x0 = b['maxX'] - 3 - pw if sx > 0 else b['minX'] + 3
        z0 = b['maxZ'] - 3 - pd if sz > 0 else b['minZ'] + 3
        plat = dict(minX=r1(x0), maxX=r1(x0 + pw), minZ=r1(z0), maxZ=r1(z0 + pd), h=0.3)
        a['platforms'].append(plat)
        a['rocks'] = [o for o in a['rocks'] if not (plat['minX'] - o['r'] - 1 < o['x'] < plat['maxX'] + o['r'] + 1 and plat['minZ'] - o['r'] - 1 < o['z'] < plat['maxZ'] + o['r'] + 1)]

ccx, ccz = center('camp')
field = dict(
    schemaVersion=1, id='field.basin', name='風礫盆地',
    note='フィールド = エリアに分かれた狩場（D-066）。野営地と 10 エリア。座標は 1 つの空間で、エリアを 240m おきに離して置いてある（別のエリアの相手とは、距離が遠いので関わらない）。exits へ入ると、行き先のエリアの arrive へ移る。large の付いた出口は、大型モンスターも通る（arriveLarge）。エリア 3 は maps/basin_training.json と同じ形。岩と段差の位置は tools/gen-field.py が種から作った仮の配置で、設定図は無い。',
    legacyMapId=legacy['id'], legacyAreaId='a3',
    start=dict(areaId='camp', x=r1(ccx - 4), z=r1(ccz), yaw=round(math.pi / 2, 4)),
    camp=dict(x=r1(ccx - 9), z=r1(ccz + 4), r=3.5),
    timeLimitScale=2,
    roam=dict(note='大型の移動と休息。stayTicks の間エリアに居て、次のエリアへ歩いて出る。体力が limpHpRatio 以下になると、巣（nest）へ向かい、sleepTicks の間眠って、体力を sleepHealCap まで戻す。攻撃されると起きる。机上の値',
              stayTicks=[5400, 9000], walkSpeedScale=1.25, limpSpeedScale=0.7, limpHpRatio=0.25, sleepTicks=3600, sleepHealPerSec=0.004, sleepHealCap=0.4, wakeStayTicks=1800, wanderSpeedScale=0.55, wanderIdleTicks=[240, 540], wanderInset=10, loseSightTicks=600),
    # 大型 11 種（v0.17.0）は、本来の狩場が無いので、ここを借りる（巡り方は tools/gen-monsters.py の route と同じ）
    routes={'monster.galdros': dict(start='a3', roam=['a3', 'a7', 'a4', 'a2'], nest='a10'),
            'monster.selvark': dict(start='a2', roam=['a2', 'a4', 'a3'], nest='a10'), 'monster.numeradon': dict(start='a4', roam=['a4', 'a7', 'a3'], nest='a10'), 'monster.bornakel': dict(start='a7', roam=['a7', 'a4', 'a2'], nest='a10'), 'monster.ashreia': dict(start='a6', roam=['a6', 'a9', 'a3'], nest='a10'), 'monster.lumisca': dict(start='a9', roam=['a9', 'a6', 'a3'], nest='a10'), 'monster.orglass': dict(start='a3', roam=['a3', 'a6', 'a9'], nest='a10'), 'monster.tengaro': dict(start='a7', roam=['a7', 'a3', 'a6'], nest='a10'), 'monster.verito': dict(start='a4', roam=['a4', 'a2', 'a3'], nest='a10'), 'monster.razmer': dict(start='a2', roam=['a2', 'a3', 'a7'], nest='a10'), 'monster.kirisave': dict(start='a6', roam=['a6', 'a3', 'a2'], nest='a10'), 'monster.velgait': dict(start='a9', roam=['a9', 'a6', 'a7'], nest='a10')},
    areas=[areas[a[0]] for a in AREAS],
)
def dump(o): return json.dumps(o, ensure_ascii=False)
out = ['{']
for k in ('schemaVersion', 'id', 'name', 'note', 'legacyMapId', 'legacyAreaId', 'start', 'camp', 'timeLimitScale', 'roam', 'routes'):
    out.append(f'  {json.dumps(k)}: {dump(field[k])},')
out.append('  "areas": [')
for i, a in enumerate(field['areas']):
    out.append('    {')
    keys = [k for k in a if k not in ('rocks', 'platforms', 'exits')]
    out.append('      ' + ', '.join(f'{json.dumps(k)}: {dump(a[k])}' for k in keys) + ',')
    for k in ('exits', 'rocks', 'platforms'):
        out.append(f'      {json.dumps(k)}: [' + ('\n        ' + ',\n        '.join(dump(x) for x in a[k]) + '\n      ' if a[k] else '') + ']' + (',' if k != 'platforms' else ''))
    out.append('    }' + (',' if i < len(field['areas']) - 1 else ''))
out += ['  ]', '}']
open(os.path.join(ROOT, 'fields', 'basin.json'), 'w', encoding='utf8').write('\n'.join(out) + '\n')
print('areas', len(field['areas']), 'rocks', [len(a['rocks']) for a in field['areas']], 'exits', sum(len(a['exits']) for a in field['areas']))
