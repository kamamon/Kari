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
         ai=None, amp=None, bind=(), spinDeg=None, brake=None, open=None):
    """技 1 つ。startup = 攻撃の始まり、active = 攻撃の終わり（tick）。curve = (距離 m, 始め, 終わり)。anim = A(...)（種ごとの動き）。
    spinDeg = 体ごと回る角度（v0.65.0。足を踏み替える向き直り。+ で左回り。startup 〜 active の間に simulation の向きが回る）。
    brake = (始め, 終わり)（v0.66.0。突進の制動。#19 の M02）: 走る間（始め〜終わり）に壁・段・岩で前へ進めない tick が 3 つ続くと、終わりへ進める。
    open = 後隙の反撃（v0.73.0。#19 の M02。D-171）: 後隙の中に、狙える部位が低い所で止まる区間を作る。攻撃の技には必ず書く。
    種の技の一覧を opened(...) に通すと決まる（書き方と決まりは opened の説明）。'部位' / (部位, 始めの tick, 終わりの tick) / False（隙を作らない）。"""
    assert isinstance(anim, dict) and anim.get('K'), f'{name}: 動きは A(K(...)...) で書く'
    if brake:
        assert curve and curve[1] <= brake[0] < brake[1] <= curve[2] <= dur, f'{name}: 制動の区間は、走る区間の中に置く'
    return dict(name=name, dur=dur, startup=startup, active=active, anim=anim, side=side, hits=list(hits), tracks=list(tracks), hazards=list(hazards), curve=curve,
                dirDeg=dirDeg, turn=turn, sounds=list(sounds), vfx=list(vfx), slamTrack=slamTrack, ai=ai, amp=amp, bind=list(bind), spinDeg=spinDeg, brake=brake, open=open)


FOLLOW_STEP = 6
OPEN_TICKS, OPEN_HEAVY_TICKS = 24, 30


def move_damage(mv):
    return max([h.get('baseDamage', 0) for h in mv['hits']] + [h.get('baseDamage', 0) for h in mv['hazards']] + [0])


def opened(expose, moves, *, lead=4, back=8):
    """後隙の反撃（v0.73.0。#19 の M02 の「空振り後の反撃部位」。D-171）: 種の技の一覧に、後隙の「狙える部位が低い所で止まる区間」を付ける。
    技の open の書き方:
      '部位'                               区間は自動（始め = 攻撃の終わり + lead tick より後の、最初の 6 の倍数。長さ 24 tick、大技は 30 tick）
      (部位, 始めの tick, 終わりの tick)     区間を決める（技の始めから数えて、6 の倍数 = 部位の追従の表の刻み）。4 つ目に、終わりの鍵の戻し方（既定 0.94）
      False                                隙を作らない技（退きながら当てる技など。理由を横に書き、tests/creature-openings.test.ts の NO_OPENING にも書く）
    大技 = その種のいちばん強い一撃の 9 割以上の技。
    止まる姿勢:
      動きに KO(...) があれば、その姿勢（技ごとに書いた形）。その間に、ほかの後隙の鍵は置かない。
      無ければ、後隙の最初の鍵（無ければ攻撃の最後の鍵）の姿勢に、expose[部位]（種ごとの「その部位を低く出す形」）を上書きした姿勢。
      後隙の残りの鍵は、区間の後ろへ詰める。
    生成器が、区間の終わりに同じ姿勢（わずかに戻した形）の鍵を足す。区間の後、技の終わりまで back tick 以上を残す（足りなければ、技の長さをのばす）。"""
    top = max(move_damage(mv) for mv in moves)
    for mv in moves:
        op, name = mv['open'], mv['name']
        keys = mv['anim']['K']
        ko = [k for k in keys if k.get('open')]
        if not op:
            assert op is False or not (mv['hits'] or mv['hazards']), f'{name}: 攻撃の技は open を書く（隙を作らない技は open=False）'
            assert not ko, f'{name}: KO(...) は open と一緒に書く'
            continue
        a1, dur = mv['active'], mv['dur']
        rec = dur - a1
        if isinstance(op, str):
            op = (op,)
        part = op[0]
        t0 = op[1] if len(op) > 1 else -(-(a1 + lead) // FOLLOW_STEP) * FOLLOW_STEP
        t1 = op[2] if len(op) > 2 else t0 + (OPEN_HEAVY_TICKS if move_damage(mv) >= 0.9 * top else OPEN_TICKS)
        relax = op[3] if len(op) > 3 else 0.94
        assert t0 % FOLLOW_STEP == 0 and t1 % FOLLOW_STEP == 0 and a1 < t0 < t1, f'{name}: 隙の区間（{t0}〜{t1}）は、後隙の中の 6 の倍数'
        assert t1 + back <= dur, f'{name}: 隙（{t0}〜{t1}）の後に戻る間が無い（技の長さ {dur} を {t1 + back} 以上に）'
        assert all(h['to'] <= t0 for h in mv['hits']), f'{name}: 隙は最後の判定の後'
        f0, f1 = (t0 - a1) / rec, (t1 - a1) / rec
        rk = sorted([k for k in keys if k['p'] == 'r' and not k.get('open')], key=lambda k: k['t'])
        if ko:
            assert len(ko) == 1, f'{name}: KO(...) は 1 つ'
            k0 = ko[0]
            assert all(k['t'] < f0 - 1e-6 or k['t'] > f1 + 1e-6 for k in rk), f'{name}: 隙の間（{t0}〜{t1}）に、ほかの鍵を置かない'
        else:
            assert part in expose, f'{name}: 部位 {part} を低く出す形（expose）が無い。KO(...) で書くか、expose に足す'
            if rk:
                base, old = rk[0], rk[0]['t']
                at = keys.index(base)
                keys.remove(base)
            else:
                base, old = [k for k in keys if k['p'] == 's'][-1], 0.0
                at = len(keys)
            pose = dict(base['pose'])
            pose.update(_clean(expose[part]))
            k0 = {'p': 'r', 't': None, 'open': True, 'pose': pose}
            if base['p'] == 'r' and base.get('e'):
                k0['e'] = base['e']
            keys.insert(at, k0)
            for k in rk[1:]:
                k['t'] = round(f1 + (k['t'] - old) / (1 - old) * (1 - f1), 5)
                assert f1 < k['t'] <= 1, (name, k['t'])
        k0['t'] = round(f0, 5)
        mv['open'] = (part, t0, t1, relax)
    return moves


def turns(w, s1, s2, *, slow=0, flags=None, sound='galdros_scrape'):
    """足を踏み替える向き直り（v0.65.0。#19 の M01。D-162）の 4 つの技 turn_l90・turn_r90・turn_l180・turn_r180。
    体の向きは simulation が回す（技の spin。ゆっくり始まってゆっくり止まる。回っている間は狩人を追わない）。判定は無い。
    四足と二足の脚は、描画が向きの速さで踏み替えて、支えている足を地面に留める（ここで脚の鍵は書かない）。
    w = 構えの終わり（回る向きへ首を向け始め、尾を少し反対へ）、s1 = 回り始め、s2 = 回り終わりの手前（どれも左へ回る時の値）。
    90° は 0.65 倍。slow = 重い体・長い体の分だけ長くする tick（90° は 44 + slow、180° は 72 + slow × 1.5。ガルドロスと同じ形。Kari の仮の値）。"""
    out = []
    for deg, dur in ((90, 44 + slow), (180, 72 + slow + slow // 2)):
        big = 1.0 if deg == 180 else 0.65
        for sd, n in ((1, 'l'), (-1, 'r')):
            anim = A(K('w', 1.0, None, **scale(w, big)), K('s', 0.3, None, **scale(s1, big)), K('s', 0.7, None, **scale(s2, big)),
                     K('s', 1.0, None, **scale(s2, 0.25 * big)), K('r', 0.6, None, **scale(s2, 0.06)), **(flags or {}))
            out.append(move(f'turn_{n}{deg}', dur, 6, dur - 8, anim, side=sd, spinDeg=deg * sd, sounds=[(4, sound)]))
    return out


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


def KO(e=None, **pose):
    """隙で止まる姿勢（v0.73.0。後隙の反撃）。技の open=(部位, 始めの tick, 終わりの tick) の始めの tick に置かれる（位置は opened が決める）"""
    d = {'p': 'r', 't': None, 'open': True, 'pose': _clean(pose)}
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
