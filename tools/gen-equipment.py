#!/usr/bin/env python3
"""ChatGPT の全装備四級版（Pull Request #15）の設計データから、いま作れる装備を、ゲームが読む形にする（npm run equipment:gen。v0.32.0、v0.33.0）。

  入力  docs/source/chatgpt-equipment-20261125/data/all-equipment.json   設計の全データ（runtimeImportable: false の提案。そのまま読み込まない）
        public/data/items*.json・loot*.json・quests_errands.json         いまある素材と、手に入る所
  出力  public/data/equipment_series.json                                 武器・防具・作るレシピと、これまでの防具（岩殻〜輝殻）の耐性・技能（content.json の equipment）
        public/data/skills.json                                           防具の技能（content.json の skills）

選ぶもの（docs/spec.md の 29 章・30 章、D-113・D-114）:
  - 系列は SERIES の 19 個（遊べる 20 種のうち、ガルドロスの他。無属性 2・会心 3・単属性 9・状態異常 5）。
    v0.33.0 で、属性と状態異常の計算（src/game/gear.ts・ailment.ts）と一緒に、単属性と状態異常の系列を入れた
  - 級は初級（rank 1）だけ。中級から先の素材を落とす個体が、まだ居ない
  - レシピの素材が、いまの素材と手に入る所（狩り・群れ・採集の依頼の報酬表）に全部ある時だけ（無ければ止まる）
  - 技能は、いまの計算で働く SKILLS の 12 個だけ（採集・採掘・虫取り・素材観察の 4 つは、採取の系列と一緒に入れる）。
    働かない技能を持つ防具は、止まる
直すこと（数値は設計のまま。変えない）:
  - 恒久 ID: 設計の proposal.* を、weapon.<武器種>.<種>.r1・armor.<部位>.<種>.r1・recipe.craft.<武器|防具>.<種>.<武器種|部位>.r1 にする
  - 状態異常の名前: 設計の paralysis を、ゲームの para にする（毒 poison・睡眠 sleep は同じ）
  - 武器の形の asset は、その武器種の里の武器（model.weapon.<武器種>.001。仮。系列の原画からの形は、まだ）
  - 防具の見た目の asset は付けない（里の服のまま。仮）
  - 防具の耐性は 0 でないものだけ書く
出力は手で編集しない。設計のデータか、SERIES を変えたら、もう一度これを走らせる。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json')
DATA = os.path.join(ROOT, 'public/data')
OUT = os.path.join(DATA, 'equipment_series.json')
SKILLS_OUT = os.path.join(DATA, 'skills.json')

# 入れる系列（設計の series の id）。遊べる種（ガルドロスの他）。登録簿の順
SERIES = [
    'series.selvark', 'series.numeradon', 'series.bornakel', 'series.ashreia', 'series.lumisca', 'series.orglass',
    'series.tengaro', 'series.verito', 'series.razmer', 'series.kirisave', 'series.velgait',
    'series.kordopil', 'series.palseit', 'series.numaporon', 'series.chilumicana', 'series.kohalgis',
    'series.mitogaron', 'series.yurtepica', 'series.hinasalv',
]
RANK = 1
# 複合（compound）は上級・極級だけ（設計）。初級には無い
PROFILES = {'raw', 'precision', 'single', 'status'}
PROFILE_NAMES = {'raw': '無属性', 'precision': '会心', 'single': '単属性', 'status': '状態異常'}
ELEMENTS = {'fire', 'thunder', 'ice', 'water', 'wind', 'mist'}
STATUS = {'poison': 'poison', 'paralysis': 'para', 'sleep': 'sleep'}
# いまの計算で働く技能（src/game/gear.ts）
SKILLS = ['guard_economy', 'edge_keep', 'dodge_economy', 'stamina_recovery', 'part_damage', 'element_tuning',
          'status_tuning', 'weak_crit', 'stun_tuning', 'item_efficiency', 'status_resistance', 'element_resistance']
# これまでの防具（ガルドロスの岩殻〜輝殻。級 1〜4）。設計の proposedAdditions の耐性と技能を、元の防具へ足す
GALDROS_TIERS = {1: '002', 2: '003', 3: '004', 4: '005'}
FAMILIES = ['heavy_blade', 'guard_blade', 'war_maul', 'twin_blades', 'long_blade', 'long_lance', 'ring_bow']
SLOTS = ['head', 'chest', 'arms', 'waist', 'legs']


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def traits(a, where):
    """防具の耐性（0 でないもの）と技能"""
    out = {}
    res = {k: v for k, v in a['resistances'].items() if v}
    if any(k not in ELEMENTS for k in res):
        sys.exit(f'{where}: 耐性に知らない属性 {sorted(res)}')
    if res:
        out['resist'] = res
    sk = a.get('skill')
    if sk:
        if sk['id'] not in SKILLS:
            sys.exit(f'{where}: 技能 {sk["id"]} は、まだ働かない')
        if sk['points'] != 1:
            sys.exit(f'{where}: 技能の点が 1 でない')
        o = {'id': sk['id'], 'points': sk['points']}
        prm = sk.get('parameters') or {}
        if sk['id'] == 'element_resistance':
            if prm.get('element') not in ELEMENTS:
                sys.exit(f'{where}: 個別属性耐性に属性が無い')
            o['element'] = prm['element']
        elif sk['id'] == 'status_resistance':
            if prm.get('status') not in STATUS:
                sys.exit(f'{where}: 個別状態耐性に状態異常が無い')
            o['status'] = STATUS[prm['status']]
        elif prm:
            sys.exit(f'{where}: 技能 {sk["id"]} に、知らない parameters {prm}')
        out['skill'] = o
    return out


def write_json(path, out):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{\n')
        keys = list(out.keys())
        for k in keys:
            v = out[k]
            end = ',' if k != keys[-1] else ''
            if isinstance(v, list):
                f.write(f'  "{k}": [\n' + ',\n'.join('    ' + json.dumps(x, ensure_ascii=False) for x in v) + f'\n  ]{end}\n')
            elif isinstance(v, dict) and k == 'armorTraits':
                f.write(f'  "{k}": {{\n' + ',\n'.join(f'    "{i}": ' + json.dumps(x, ensure_ascii=False) for i, x in v.items()) + f'\n  }}{end}\n')
            else:
                f.write(f'  "{k}": {json.dumps(v, ensure_ascii=False)}{end}\n')
        f.write('}\n')


def main():
    with open(SRC, encoding='utf-8') as f:
        d = json.load(f)
    if d.get('runtimeImportable') is not False:
        sys.exit('設計のデータの runtimeImportable が false でない（形が変わった？）')
    # いまある素材と、手に入る所
    mats = {}
    for name in ('items.json', 'items_creatures.json'):
        for m in load(name).get('materials', []):
            mats[m['id']] = m['name']
    obtain = set()
    for name in ('loot.json', 'loot_creatures.json', 'quests_errands.json'):
        with open(os.path.join(DATA, name), encoding='utf-8') as f:
            obtain |= set(re.findall(r'"(mat\.[a-z0-9_.]+)"', f.read()))
    series = {s['id']: s for s in d['series']}
    weapons, armor, recipes, summary = [], [], [], []
    for sid in SERIES:
        s = series.get(sid)
        if not s:
            sys.exit(f'設計に系列 {sid} が無い')
        if s['weaponProfile'] not in PROFILES:
            sys.exit(f'{sid}: 型 {s["weaponProfile"]} は、まだ入れない')
        sp = s['sourceSpeciesId'].split('.', 1)[1]
        ws = {w['family']: w for w in d['weaponCandidates'] if w['seriesId'] == sid and w['rank'] == RANK}
        ars = {a['slot']: a for a in d['armorCandidates'] if a['seriesId'] == sid and a['rank'] == RANK}
        rs = {r['resultId']: r for r in d['recipes'] if r.get('seriesId') == sid and r['rank'] == RANK and r['kind'] == 'craft'}
        if sorted(ws) != sorted(FAMILIES) or sorted(ars) != sorted(SLOTS):
            sys.exit(f'{sid}: 初級の武器 7・防具 5 がそろっていない')
        ids = {}
        for fam in FAMILIES:
            w = ws[fam]
            prof = w['profile']
            if prof != s['weaponProfile']:
                sys.exit(f'{w["id"]}: 型が系列と違う')
            element = {'type': 'none', 'value': 0}
            status = None
            if prof == 'single':
                if len(w['elements']) != 1 or w['elements'][0] not in ELEMENTS or not w['elementValue'] > 0 or w['status']:
                    sys.exit(f'{w["id"]}: 単属性の値が不正')
                element = {'type': w['elements'][0], 'value': w['elementValue']}
            elif prof == 'status':
                if w['elements'] or w['elementValue'] or w['status'] not in STATUS or not w['statusPotency'] > 0:
                    sys.exit(f'{w["id"]}: 状態異常の値が不正')
                status = {'kind': STATUS[w['status']], 'potency': w['statusPotency']}
            elif w['elements'] or w['status'] or w['elementValue'] or w['statusPotency']:
                sys.exit(f'{w["id"]}: 無属性・会心の型に、属性か状態異常がある')
            wid = f'weapon.{fam}.{sp}.r1'
            ids[w['id']] = ('weapon', wid, fam)
            o = {
                'id': wid, 'family': fam, 'name': w['name'], 'attack': w['attack'],
                'element': element, 'affinity': w['affinity'], 'sharpnessModifier': w['sharpnessModifier'],
            }
            if status:
                o['status'] = status
            o.update({'assetId': f'model.weapon.{fam}.001', 'series': sid, 'rankId': f'rank.{RANK}'})
            weapons.append(o)
        for slot in SLOTS:
            a = ars[slot]
            aid = f'armor.{slot}.{sp}.r1'
            ids[a['id']] = ('armor', aid, slot)
            armor.append({'id': aid, 'slot': slot, 'name': a['name'], 'defense': a['defense'], **traits(a, a['id']), 'series': sid, 'rankId': f'rank.{RANK}'})
        for pid, (kind, rid, part) in ids.items():
            r = rs.get(pid)
            if not r:
                sys.exit(f'{pid}: 作るレシピが無い')
            if r.get('consumesPrevious') or r.get('fromId'):
                sys.exit(f'{pid}: 作るレシピが、元の装備を使う')
            items = []
            for i in r['ingredients']:
                if i['materialId'] not in mats:
                    sys.exit(f'{pid}: 素材 {i["materialId"]} が、いまの素材に無い')
                if i['materialId'] not in obtain:
                    sys.exit(f'{pid}: 素材 {i["materialId"]} が、いま手に入らない')
                items.append({'itemId': i['materialId'], 'count': i['count']})
            rec = {'id': f'recipe.craft.{kind}.{sp}.{part}.r1', 'kind': 'craft' if kind == 'weapon' else 'armor_craft', 'cost': {'money': r['money'], 'items': items}}
            rec['resultWeaponId' if kind == 'weapon' else 'resultArmorId'] = rid
            recipes.append(rec)
        summary.append(f'{s["name"]}（{s["seriesName"]}・{s["weaponProfile"]}）')
    # これまでの防具（岩殻〜輝殻）へ足す耐性と技能
    armor_traits = {}
    for a in d['armorCandidates']:
        if a['seriesId'] != 'series.galdros' or a['rank'] not in GALDROS_TIERS:
            continue
        rid = (a.get('sourceRecord') or {}).get('id')
        want = f'armor.{a["slot"]}.{GALDROS_TIERS[a["rank"]]}'
        if not a.get('runtimeExists') or rid != want or a['id'] != want:
            sys.exit(f'{a["id"]}: これまでの防具 {want} と合わない')
        armor_traits[want] = traits(a, a['id'])
    if len(armor_traits) != len(GALDROS_TIERS) * len(SLOTS):
        sys.exit(f'これまでの防具の耐性と技能が {len(armor_traits)} 個（{len(GALDROS_TIERS) * len(SLOTS)} 個のはず）')
    profiles = {}
    for s in summary:
        p = s.rsplit('・', 1)[1].rstrip('）')
        profiles[p] = profiles.get(p, 0) + 1
    out = {
        'schemaVersion': 1,
        'note': 'tools/gen-equipment.py（npm run equipment:gen）の出力。手で編集しない。ChatGPT の全装備四級版（Pull Request #15、docs/source/chatgpt-equipment-20261125/）のうち、'
                f'遊べる種の {len(SERIES)} 系列（{"・".join(f"{PROFILE_NAMES[k]} {profiles[k]}" for k in PROFILE_NAMES if k in profiles)}）の初級の武器 {len(weapons)}・防具 {len(armor)} と、それを作るレシピ {len(recipes)}、'
                'これまでの防具（岩殻〜輝殻）の耐性と技能 armorTraits（docs/spec.md の 29 章・30 章、D-113・D-114）。'
                '数値・素材・費用・耐性・技能は設計のまま。形の絵は、まだ入れていない（武器の形は里の武器、防具は里の服のまま）',
        'source': 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json',
        'weapons': weapons, 'armor': armor, 'recipes': recipes, 'armorTraits': armor_traits,
    }
    write_json(OUT, out)
    rules = d['rules']['skills']
    skills = []
    for sid in SKILLS:
        r = rules.get(sid)
        if not r or len(r['values']) != 3:
            sys.exit(f'設計に技能 {sid} が無い（か、Lv が 3 つでない）')
        skills.append({'id': sid, 'name': r['name'], 'values': r['values'], 'unit': r['unit'], 'effect': r['effect']})
    write_json(SKILLS_OUT, {
        'schemaVersion': 1,
        'note': 'tools/gen-equipment.py（npm run equipment:gen）の出力。手で編集しない。ChatGPT の全装備四級版（#15）の rules.skills のうち、いまの計算で働く技能（docs/spec.md の 30 章）。'
                'Lv は防具の点の合計（1 部位 1 点、3 まで）。values は Lv 1〜3 の値',
        'source': 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json',
        'skills': skills,
    })
    print(f'系列 {len(SERIES)}（{"、".join(summary)}）。武器 {len(weapons)}・防具 {len(armor)}・レシピ {len(recipes)}・これまでの防具の耐性と技能 {len(armor_traits)} → {os.path.relpath(OUT, ROOT)}')
    print(f'技能 {len(skills)} → {os.path.relpath(SKILLS_OUT, ROOT)}')


if __name__ == '__main__':
    main()
