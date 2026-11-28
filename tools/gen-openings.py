#!/usr/bin/env python3
"""大型の技の後隙の反撃（docs/spec.md の 32.39。v0.73.0、D-171）の一覧 docs/monster-openings.md を作り、
スパインゲイルの技データへ、区間（opening）を書く。`npm run monsters:gen` で走る（その後に、ガルドロスの追従の表を作り直す monsters:bake が走る）。

v0.75.0（利用者の指示。D-175）で、白紙にした 19 種（大型 11・幼体 8）をゲームから外した。それまでの tools/gen-monsters.py
（19 種の体・技・依頼・素材・見た目の設計図を作る道具。tools/monster_moves.py・tools/monster_lib.py と一緒）は、この道具に置き換えた。
残っているのは、どの種にも要る 2 つの仕事だけ:
  - スパインゲイル（体と動きは GLB。技データは ChatGPT の #50）の区間を、SPINEGALE_OPEN から書く（動きは変えない）
  - 向き直りを持つ大型の、技ごとの区間の一覧を作る（ガルドロス = tools/gen-galdros-moves.mjs の OPEN と actions/galdros.json、
    フロストアルド = 届いたまま）
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')


def dump_lines(obj_list, indent='    '):
    return (',\n').join(indent + json.dumps(o, ensure_ascii=False) for o in obj_list)


def list_doc(head, key, items):
    out = ['{']
    for k, v in head.items():
        out.append(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},')
    out.append(f'  {json.dumps(key)}: [')
    out.append(dump_lines(items))
    out.append('  ]')
    out.append('}')
    return '\n'.join(out) + '\n'


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(text)


# スパインゲイル（ChatGPT の Pull Request #50。体と動きは GLB、技データは public/data/actions/spinegale.json）の後隙の反撃（v0.73.0。D-171）。
# 動きは変えない。いまの動きで決まり（20 tick 以上・大技は 30 以上・下の端が 1.6m 以下・ほとんど動かない・技の移動が終わっている・避けた狩人が斬れる）を
# 満たす区間だけを書く（ガルドロスの tools/gen-galdros-moves.mjs の OPEN と同じ考え）。部位は 喉袋（斬りがいちばん通る）・後脚・頭の冠棘。
# 突進（dash）は書かない: 走り抜けた後、止まるまで 0.55m 滑り、止まってからは 12 tick しか無い（この種の大きな隙は、走った後の息切れ）。
SPINEGALE_OPEN = {
    'bite': ('dewlap', 36, 60), 'double_bite': ('legs', 66, 102), 'turn_bite': ('dewlap', 54, 78),
    'pounce': ('dewlap', 78, 120), 'jump_kick': ('dewlap', 78, 114),
    'tail_sweep_l': ('legs', 54, 90), 'tail_sweep_r': ('legs', 54, 90), 'tail_sweep_l_short': ('legs', 54, 90), 'tail_sweep_r_short': ('legs', 54, 90),
    'side_strike_l': ('legs', 54, 84), 'side_strike_r': ('legs', 54, 84),
    'triple_dash': ('head', 204, 234),
}


def apply_spinegale_openings():
    """public/data/actions/spinegale.json の技へ、SPINEGALE_OPEN の区間（opening）を書く。ほかの値は変えない。1 つの技を 1 行にして書く（差分を読みやすくする）。"""
    path = 'public/data/actions/spinegale.json'
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return
    doc = json.loads(open(full, encoding='utf-8').read())
    assert list(doc) == ['schemaVersion', 'actions'], list(doc)
    left = dict(SPINEGALE_OPEN)
    for a in doc['actions']:
        a.pop('opening', None)
        o = left.pop(a['actionId'].split('.')[-1], None)
        if o:
            assert a['hitWindows'], a['actionId']
            a['opening'] = {'partId': o[0], 'from': o[1], 'to': o[2]}
    assert not left, f'スパインゲイルに無い技: {sorted(left)}'
    write(path, list_doc({'schemaVersion': doc['schemaVersion']}, 'actions', doc['actions']))


# 届いたままの区間（検査 tests/creature-openings.test.ts に入れていない種）。一覧に、そのことを書く（D-173: Claude は、届いた種の動きと区間を直さない）
OPENINGS_AS_RECEIVED = {
    'monster.frostald': '**この種の区間は、届いたまま（ChatGPT の #51。後隙のほぼ全体 = 最後の判定の 5 tick 後から、技の終わりの 3 tick 前まで）で、検査に入れていない。**'
                        ' 載せ直しの時（2026-11-28）に測ると、どの区間も、技を避けた狩人が間に合って斬れるが、18 のうち 9（`bite`・`double_bite`・`body_ram`・`roll_l`・`roll_r`・`head_slam`・`back_bite`・`ice_sweep_l`・`ice_sweep_r`）は、'
                        '部位が区間の間に 1 tick に 2cm より速く動く（「ほとんど動かない」の決まりに合わない）。区間の端は、追従の表の刻み（6 tick）の上に無い。',
}


def openings_doc():
    """後隙の反撃（v0.73.0。D-171）の一覧 docs/monster-openings.md: 大型（足を踏み替える向き直りを持つ種）の攻撃の技ごとに、狙える部位と区間。
    いま書いた技データ（public/data/actions/）から作る。ガルドロスの技（galdros.json は手で書く。galdros_ext.json は tools/gen-galdros-moves.mjs）も読む。"""
    rows = ['# 大型の技の後隙に、狙える部位（後隙の反撃）', '',
            '`npm run monsters:gen` の出力（手で編集しない）。決まりは docs/spec.md の 32.39、検査は tests/creature-openings.test.ts。', '',
            '- 区間は、技の始めから数えた tick（60 tick = 1 秒）。その間、部位の下の端は 1.6m 以下で、ほとんど動かない。',
            '- 大技 = その種のいちばん強い一撃の 9 割以上の技（区間は 30 tick 以上。ほかは 20 tick 以上）。',
            '- 「−」は、ガルドロスの横への体当たり（いまの動きでは、止まる間が短い）と、',
            '  スパインゲイルの突進（走り抜けた後、止まるまで滑る。この種の大きな隙は、走った後の息切れ）。',
            '- ガルドロスとスパインゲイルは、動きを変えずに、いまの動きで決まりを満たす区間だけを書いてある。',
            '- v0.75.0 で、白紙にした 11 種（生成の体の種）を外した（利用者の指示。D-175）。それまでは、ここに 11 種の 162 の区間も載っていた。', '']
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
        rows += [f'## {m["name"]}（`{m["id"]}`。{n} / {len(atk)}）', '']
        if m['id'] in OPENINGS_AS_RECEIVED:
            rows += [OPENINGS_AS_RECEIVED[m['id']], '']
        rows += ['| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |', '| --- | --- | --- | --- | --- |']
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


def main():
    apply_spinegale_openings()
    write('docs/monster-openings.md', openings_doc())
    print('後隙の反撃の一覧 → docs/monster-openings.md')


if __name__ == '__main__':
    main()
