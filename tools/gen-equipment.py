#!/usr/bin/env python3
"""ChatGPT の全装備四級版（Pull Request #15）の設計データから、いま作れる装備を、ゲームが読む形にする（npm run equipment:gen。v0.32.0）。

  入力  docs/source/chatgpt-equipment-20261125/data/all-equipment.json   設計の全データ（runtimeImportable: false の提案。そのまま読み込まない）
        public/data/items*.json・loot*.json・quests_errands.json         いまある素材と、手に入る所
  出力  public/data/equipment_series.json                                 武器・防具・作るレシピ（content.json の equipment）

選ぶもの（docs/spec.md の 29 章、D-113）:
  - 系列は SERIES の 5 つ（無属性 2・会心 3）。属性（単属性・複合）と状態異常の系列は、属性と状態異常の計算を入れるまで入れない
    （設計の引き継ぎ 3 章: 属性値だけを入れると、比べ方が正しくならない）
  - 級は初級（rank 1）だけ。中級から先の素材を落とす個体が、まだ居ない
  - レシピの素材が、いまの素材と手に入る所（狩り・群れ・採集の依頼の報酬表）に全部ある時だけ（無ければ止まる）
直すこと（数値は設計のまま。変えない）:
  - 恒久 ID: 設計の proposal.* を、weapon.<武器種>.<種>.r1・armor.<部位>.<種>.r1・recipe.craft.<武器|防具>.<種>.<武器種|部位>.r1 にする
  - 武器の形の asset は、その武器種の里の武器（model.weapon.<武器種>.001。仮。系列の原画からの形は、まだ）
  - 防具の見た目の asset は付けない（里の服のまま。仮）
  - 技能・耐性・会心以外の設計の欄は、データに入れない（まだ働かない）
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

# 入れる系列（設計の series の id）。いまのダメージの計算（攻撃力と会心）だけで、設計どおりに働くもの
SERIES = ['series.bornakel', 'series.orglass', 'series.razmer', 'series.kordopil', 'series.kohalgis']
RANK = 1
PROFILES = {'raw', 'precision'}
FAMILIES = ['heavy_blade', 'guard_blade', 'war_maul', 'twin_blades', 'long_blade', 'long_lance', 'ring_bow']
SLOTS = ['head', 'chest', 'arms', 'waist', 'legs']


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


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
        if s['weaponProfile'] not in PROFILES or s.get('elements') or s.get('status'):
            sys.exit(f'{sid}: 属性・状態異常の系列は、まだ入れない（{s["weaponProfile"]}）')
        sp = s['sourceSpeciesId'].split('.', 1)[1]
        ws = {w['family']: w for w in d['weaponCandidates'] if w['seriesId'] == sid and w['rank'] == RANK}
        ars = {a['slot']: a for a in d['armorCandidates'] if a['seriesId'] == sid and a['rank'] == RANK}
        rs = {r['resultId']: r for r in d['recipes'] if r.get('seriesId') == sid and r['rank'] == RANK and r['kind'] == 'craft'}
        if sorted(ws) != sorted(FAMILIES) or sorted(ars) != sorted(SLOTS):
            sys.exit(f'{sid}: 初級の武器 7・防具 5 がそろっていない')
        ids = {}
        for fam in FAMILIES:
            w = ws[fam]
            if w['elements'] or w['status'] or w['elementValue'] or w['statusPotency']:
                sys.exit(f'{w["id"]}: 属性か状態異常がある')
            wid = f'weapon.{fam}.{sp}.r1'
            ids[w['id']] = ('weapon', wid, fam)
            weapons.append({
                'id': wid, 'family': fam, 'name': w['name'], 'attack': w['attack'],
                'element': {'type': 'none', 'value': 0}, 'affinity': w['affinity'], 'sharpnessModifier': w['sharpnessModifier'],
                'assetId': f'model.weapon.{fam}.001', 'series': sid, 'rankId': f'rank.{RANK}',
            })
        for slot in SLOTS:
            a = ars[slot]
            aid = f'armor.{slot}.{sp}.r1'
            ids[a['id']] = ('armor', aid, slot)
            armor.append({'id': aid, 'slot': slot, 'name': a['name'], 'defense': a['defense'], 'series': sid, 'rankId': f'rank.{RANK}'})
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
    out = {
        'schemaVersion': 1,
        'note': 'tools/gen-equipment.py（npm run equipment:gen）の出力。手で編集しない。ChatGPT の全装備四級版（Pull Request #15、docs/source/chatgpt-equipment-20261125/）のうち、'
                'いまのダメージの計算で働く 5 系列（無属性 2・会心 3）の初級の武器 35・防具 25 と、それを作るレシピ 60（docs/spec.md の 29 章、D-113）。'
                '数値・素材・費用は設計のまま。技能・耐性・形の絵は、まだ入れていない（武器の形は里の武器、防具は里の服のまま）',
        'source': 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json',
        'weapons': weapons, 'armor': armor, 'recipes': recipes,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('{\n')
        keys = list(out.keys())
        for k in keys:
            v = out[k]
            end = ',' if k != keys[-1] else ''
            if isinstance(v, list):
                f.write(f'  "{k}": [\n' + ',\n'.join('    ' + json.dumps(x, ensure_ascii=False) for x in v) + f'\n  ]{end}\n')
            else:
                f.write(f'  "{k}": {json.dumps(v, ensure_ascii=False)}{end}\n')
        f.write('}\n')
    print(f'系列 {len(SERIES)}（{"、".join(summary)}）。武器 {len(weapons)}・防具 {len(armor)}・レシピ {len(recipes)} → {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
