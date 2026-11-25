"""大型と幼体のモンスターのデータを書くための部品（tools/gen-monsters.py と tools/monster_moves.py が使う。v0.21.0 で分けた）。

技の動きは、種ごとに固有の「鍵の姿勢」（src/render/creatureMoves.ts の MoveDef）で書く:
  K(区間, 位置, 補間, **姿勢)  区間は w = 構え（startup）、s = 攻撃（active）、r = 後隙（recovery）。位置は区間の中の 0〜1。
  A(*鍵, **決まり)            1 つの技の動き（hop・shake・spin・seq など）。
  B(軌道, 印a, 印b, 太さ)       判定の形を体の部位に付ける。npm run monsters:bake が、動きの中の部位の位置から軌道を作り直す。
                               印は sp:点 / leg:組:側:関節 / own:名前:側 / tip:名前:側（側: S = 技の側、O = 反対、L、R、C）。
姿勢の値（rad と、体の高さ H に対する割合）:
  yH・z・x（体のずれ）、pitch（+ で前が上がる）、roll（+ で左が上がる）、yaw（+ で左を向く）、spineYaw・spinePitch・twist（胴の前の側）、
  neckPitch（+ で首を上げる）・neckYaw・headPitch・headYaw・headRoll、tailYaw（+ で尾が左へ）・tailPitch（+ で上げる）・tailCurl・tailWave、
  crest・wing・wingS・sac・dish・plates・bags・sail・crown・glow・finger・ring・archFront・archBack・fin（ひれ足。v0.21.0）、clawR / clawL = [上げる, 内へ振る]、
  legs = {組 / 組.S / 組.O / * : (前への振り, 持ち上げ(畳む), 外への開き)}。
  左右の技（side）は、yaw・roll・x・spineYaw・neckYaw・headYaw・headRoll・twist・tailYaw に side を掛ける（左の技の値で書く）。
"""
import math


def r3(v):
    return round(v + 0.0, 3)


def unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return [r3(c / n) for c in v]


# ---------------------------------------------------------------------------------------------
# 技の部品
# ---------------------------------------------------------------------------------------------

def track(tid, radius, length, keys):
    """keys: [(t, grip[x,y,z], dir[x,y,z])]。from 0 〜 to length のカプセル。"""
    return {'id': tid, 'radius': radius, 'from': 0, 'to': length, 'keys': [{'t': t, 'grip': [r3(c) for c in g], 'dir': unit(d)} for t, g, d in keys]}


def hit(wid, t0, t1, trk, dmg, reaction='knockdown', kind='blunt', guard=True, cost=30, status=None, hits=1):
    h = {'id': wid, 'from': t0, 'to': t1, 'shapeTrack': trk, 'damageType': kind, 'damageCoefficient': 1.0, 'maxHitsPerTarget': hits, 'hitstopTicks': 0,
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


def move(name, dur, startup, active, anim, *, side=None, hits=(), tracks=(), hazards=(), curve=None, dirDeg=None, turn=None, sounds=(), vfx=(), slamTrack=None,
         ai=None, amp=None, bind=()):
    """技 1 つ。startup = 攻撃の始まり、active = 攻撃の終わり（tick）。curve = (距離 m, 始め, 終わり)。anim = A(...)（種ごとの動き）。"""
    assert isinstance(anim, dict) and anim.get('K'), f'{name}: 動きは A(K(...)...) で書く'
    return dict(name=name, dur=dur, startup=startup, active=active, anim=anim, side=side, hits=list(hits), tracks=list(tracks), hazards=list(hazards), curve=curve,
                dirDeg=dirDeg, turn=turn, sounds=list(sounds), vfx=list(vfx), slamTrack=slamTrack, ai=ai, amp=amp, bind=list(bind))


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


def both(fn):
    """左右の 2 本（+x と -x）"""
    return [fn(1), fn(-1)]


def lr(fn):
    """左右の技の組（sd = 1 が左、-1 が右。名前の末尾は _l / _r）"""
    return [fn(1, 'l'), fn(-1, 'r')]


def side_name(sd):
    return 'left' if sd > 0 else 'right'


# ---------------------------------------------------------------------------------------------
# 動き（v0.21.0）
# ---------------------------------------------------------------------------------------------

def _clean(pose):
    out = {}
    for k, v in pose.items():
        if v is None:
            continue
        if k == 'legs':
            out['legs'] = {lk: [r3(x) for x in lv] for lk, lv in v.items()}
        elif k in ('clawR', 'clawL'):
            out[k] = [r3(x) for x in v]
        else:
            out[k] = r3(v)
    return out


def K(p, t, e=None, **pose):
    """鍵の姿勢。p = 'w' / 's' / 'r'、t = 区間の中の位置（0〜1）、e = その鍵へ向かう補間（io・o・i・lin）"""
    assert p in ('w', 's', 'r') and 0 <= t <= 1, (p, t)
    d = {'p': p, 't': t, 'pose': _clean(pose)}
    if e:
        d['e'] = e
    return d


def A(*keys, **flags):
    """1 つの技の動き"""
    d = {'K': list(keys)}
    for k, v in flags.items():
        if v is not None:
            d[k] = v
    return d


def B(trk, a, b, r, ext=0.0, back=0.0):
    """判定の形を、体の部位（印 a → 印 b）に付ける。ext = b の先へ、back = a の手前へ伸ばす (m)"""
    d = {'track': trk, 'a': a, 'b': b, 'r': r}
    if ext:
        d['ext'] = ext
    if back:
        d['back'] = back
    return d


def F(fid, dur, when, *keys, shake=None):
    """しぐさ。keys の位置 t は、しぐさの長さの中の 0〜1（区間は使わないので 'w' と書く）"""
    d = {'id': fid, 'dur': dur, 'when': when, 'K': list(keys)}
    if shake:
        d['shake'] = shake
    return d


def P(**pose):
    """姿勢（鍵の外で使う: 構え・眠り・倒れる）"""
    return _clean(pose)


def idle(*, unaware, sway, nod, rate, alert, weak, rage, run, sleep, flinch, topple, rise, dead, fidgets, graze=None):
    d = dict(unaware=P(**unaware), sway=sway, nod=nod, rate=rate, alert=P(**alert), weak=P(**weak), rage=P(**rage), run=P(**run), sleep=P(**sleep),
             flinch=P(**flinch), topple=P(**topple), rise=P(**rise), dead=[{'t': t, 'pose': P(**pz)} for t, pz in dead], fidgets=list(fidgets))
    if graze:
        d['graze'] = P(**graze)
    return d


def mix(*poses, **over):
    """姿勢を足し合わせる（legs は組ごとに足す）。over は上書き"""
    out = {}
    for p in poses:
        for k, v in p.items():
            if k == 'legs':
                cur = out.setdefault('legs', {})
                for lk, lv in v.items():
                    a = list(cur.get(lk, (0, 0, 0)))
                    a += [0] * (3 - len(a))
                    b = list(lv) + [0] * (3 - len(lv))
                    cur[lk] = tuple(x + y for x, y in zip(a, b))
            elif k in ('clawR', 'clawL'):
                a = out.get(k, (0, 0))
                out[k] = (a[0] + v[0], a[1] + v[1])
            else:
                out[k] = out.get(k, 0) + v
    out.update(over)
    return out


def scale(pose, k):
    """姿勢を k 倍"""
    out = {}
    for key, v in pose.items():
        if key == 'legs':
            out['legs'] = {lk: tuple(x * k for x in lv) for lk, lv in v.items()}
        elif key in ('clawR', 'clawL'):
            out[key] = (v[0] * k, v[1] * k)
        else:
            out[key] = v * k
    return out
