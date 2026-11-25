#!/usr/bin/env python3
"""Deterministic proposal expansion; writes only inside this inbox package. No runtime import."""
import collections
import copy
import functools
import hashlib
import json
import math
import pathlib
import subprocess

PACKAGE = pathlib.Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parents[1]
SOURCE = ROOT / 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json'
SOURCE_COMMIT = '8adc7fe4fa584aa87c5a27286c8512de93a9b5a7'
FAMILIES = ['heavy_blade', 'guard_blade', 'war_maul', 'twin_blades', 'long_blade', 'long_lance', 'ring_bow']
FAMILY_NAMES = ['断岳剣', '護刃', '大槌', '双剣', '太刀', '長尖槍', '環弓']
SLOTS = ['head', 'chest', 'arms', 'waist', 'legs']
ELEMENTS = ['fire', 'thunder', 'ice', 'water', 'wind', 'mist']
CAPS = {'rawPct': [-20, 12], 'elementPct': [-30, 20], 'statusPct': [-30, 20], 'partPct': [-30, 25], 'stunPct': [-30, 15], 'affinityPoints': [-15, 15], 'guardCostPct': [-30, 25], 'dodgeCostPct': [-25, 25], 'edgeWearPct': [-25, 40], 'staminaRecoveryPct': [-25, 20], 'incomingDamagePct': [-12, 25], 'itemUseTicksPct': [-20, 25]}
ACTION_TAGS = {'charge', 'finisher', 'draw_attack', 'counter', 'thrust', 'blunt', 'slash', 'projectile'}
EVENTS = ['hit', 'guard', 'parry', 'dodge', 'charge_release', 'sheathe', 'draw', 'part_break', 'status_inflicted', 'damage_taken', 'item_used']
TAGS = sorted(ACTION_TAGS | {'weakspot', 'head', 'broken', 'unbroken', 'rear', 'poisoned', 'paralyzed', 'asleep', 'stunned'})
FINISHERS = dict(zip(FAMILIES, ['side_sweep', 'thrust', 'swing', 'flurry', 'helm', 'thrust3', 'spread']))

@functools.lru_cache(maxsize=None)
def source_bytes(relative_path):
    result = subprocess.run(['git', '-C', str(ROOT), 'show', f'{SOURCE_COMMIT}:{relative_path}'], capture_output=True)
    if result.returncode:
        raise RuntimeError(f'Pinned source {SOURCE_COMMIT} unavailable. Run git fetch origin main, then retry. Path: {relative_path}')
    return result.stdout

def read(path):
    path = pathlib.Path(path).resolve()
    if ROOT in path.parents and PACKAGE not in path.parents:
        return json.loads(source_bytes(path.relative_to(ROOT).as_posix()))
    return json.loads(path.read_text())

def write(path, data, compact=False):
    target = PACKAGE / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=None if compact else 2, separators=(',', ':') if compact else None) + '\n')

def rounded(v):
    return int(math.floor(v + .5))

def apportion(total, weights):
    raw = {s: total * weights[s] for s in SLOTS}
    out = {s: math.floor(raw[s]) for s in SLOTS}
    order = sorted(SLOTS, key=lambda s: (-(raw[s] - out[s]), SLOTS.index(s)))
    for s in order[:total - sum(out.values())]:
        out[s] += 1
    return out

def action_capabilities():
    families = read(ROOT / 'public/data/weapons.json')['families']
    result = {}
    for family in families:
        f = family['id']; actions = []
        for a in read(ROOT / f'public/data/actions/{f}.json')['actions']:
            if not (a.get('hitWindows') or a.get('shoot')):
                continue
            name = a['actionId'].split('.')[-1]
            tags = []
            if a.get('charge'):
                tags.append('charge')
            if name == FINISHERS[f]:
                tags.append('finisher')
            if a['actionId'] == family['actions']['drawAttack']:
                tags.append('draw_attack')
            if f == 'long_lance' or name in ('thrust', 'stab'):
                tags.append('thrust')
            if name == 'counter_thrust':
                tags.append('counter')
            if f == 'ring_bow':
                tags.append('projectile')
            elif any(h['damageType'] == 'blunt' for h in a.get('hitWindows', [])):
                tags.append('blunt')
            elif 'thrust' not in tags:
                tags.append('slash')
            actions.append({'actionId': a['actionId'], 'tags': tags})
        events = ['hit', 'dodge', 'draw', 'sheathe', 'part_break', 'status_inflicted', 'damage_taken']
        if f != 'ring_bow': events.append('item_used')
        if f in ('heavy_blade', 'guard_blade', 'long_lance'): events.append('guard')
        if f in ('guard_blade', 'long_lance'): events.append('parry')
        if any('charge' in a['tags'] for a in actions): events.append('charge_release')
        result[f] = {'events': events, 'actions': actions, 'maintenanceItem': None if f == 'ring_bow' else 'whetstone',
                     'finisher': f'player.{f}.{FINISHERS[f]}'}
    return result

def matching_actions(definition, capability):
    t = definition['trigger']; required = set(t['tagsAll']) & ACTION_TAGS
    any_tags = set(t['tagsAny'])
    # Context predicates are checked per resolved hit; action predicates must coexist in ONE action.
    any_actions = any_tags & ACTION_TAGS if any_tags and any_tags <= ACTION_TAGS else set()
    if t['event'] == 'charge_release': required.add('charge')
    return [a['actionId'] for a in capability['actions'] if required <= set(a['tags']) and (not any_actions or any_actions & set(a['tags']))]

def bind_trait(blueprint, family, capability):
    d = copy.deepcopy(blueprint['weaponTrait']); d['id'] += '.' + family
    t = d['trigger']; reasons = []
    if t['event'] not in capability['events']:
        old = t['event']
        if old == 'charge_release':
            t['event'] = 'hit'; t['tagsAll'] = [x for x in t['tagsAll'] if x not in ACTION_TAGS] + ['finisher']
        elif old == 'item_used':
            t['event'] = 'sheathe'; t['staminaMin'] = max(t['staminaMin'], 80); t['staminaMax'] = max(t['staminaMin'], t['staminaMax'])
        else:
            t['event'] = 'dodge'
        reasons.append(f'{old}→{t["event"]}: この武器の成功イベントに適合')
    if (t['event'] in ('hit', 'charge_release') or set(t['tagsAll'] + t['tagsAny']) & ACTION_TAGS) and not matching_actions(d, capability):
        t['event'] = 'hit'
        t['tagsAll'] = [x for x in t['tagsAll'] if x not in ACTION_TAGS] + ['finisher']
        # If ANY had only impossible actions, finisher replaces that group, not an impossible AND.
        t['tagsAny'] = [x for x in t['tagsAny'] if x not in ACTION_TAGS]
        reasons.append('同一行動で成立しない動作タグを、その武器の締め技へ置換')
    for effect in d['effects']:
        stat = effect['stat']; replacement = stat
        if stat == 'edgeWearPct' and family == 'ring_bow': replacement = 'dodgeCostPct'
        if stat == 'guardCostPct' and 'guard' not in capability['events']: replacement = 'dodgeCostPct'
        if stat == 'stunPct' and not any('blunt' in a['tags'] for a in capability['actions']): replacement = 'partPct'
        if replacement != stat:
            effect['stat'] = replacement; reasons.append(f'{stat}→{replacement}: 無効な効果を同じ値の有効な効果へ適合')
    d['sourceTraitId'] = blueprint['weaponTrait']['id']; d['family'] = family
    d['adaptations'] = reasons
    if reasons:
        d['explanation'] = ' / '.join(reasons) + '。発動条件・数値はこの定義を優先。攻撃補正は次の別行動から。'
    return d

def main():
    source = read(SOURCE)
    blueprints = [read(p) for p in sorted((PACKAGE / 'data/species').glob('*.json'))]
    assert len(blueprints) == 86 and {b['no'] for b in blueprints} == set(range(1, 87)), 'All 86 blueprints required'
    by_species = {b['speciesId']: b for b in blueprints}
    runtime_extra = read(ROOT / 'public/data/equipment_series.json')
    runtime_weapons = {w['id']: w for w in read(ROOT / 'public/data/weapons.json')['weapons'] + runtime_extra['weapons']}
    runtime_armor = {a['id']: a for a in read(ROOT / 'public/data/armor.json')['armor'] + runtime_extra['armor']}
    runtime_recipes = read(ROOT / 'public/data/recipes.json')['recipes'] + runtime_extra['recipes']
    recipes_by_result = {r.get('resultWeaponId', r.get('resultArmorId')): r for r in runtime_recipes}
    runtime_items = {i['id']: i for p in ['items.json', 'items_creatures.json'] for i in read(ROOT / ('public/data/' + p))['items']}
    variants = {(v['seriesId'], v['rank']): v for v in source['rankVariants']}
    series_map = {s['id']: s for s in source['series']}
    baseline = {(w['rank'], w['family']): w['attack'] for w in source['weaponCandidates'] if w['seriesId'] == 'series.galdros'}
    id_map = {}; material_map = {}
    for typ, key, slot_key in [('weapon', 'weaponCandidates', 'family'), ('armor', 'armorCandidates', 'slot')]:
        for item in source[key]:
            if item['sourceSpeciesId'] and item['id'].startswith('proposal.'):
                slug = item['sourceSpeciesId'].split('.')[-1]
                id_map[item['id']] = f'{typ}.{item[slot_key]}.{slug}.r{item["rank"]}'
            else:
                id_map[item['id']] = item['id']
    for m in source['materials']:
        mid = m['id']
        if not mid.startswith('proposal.material.'):
            material_map[mid] = mid; continue
        _, _, slug, role, rank_label = mid.split('.')
        series = series_map['series.' + slug]; native = series['nativeRank']
        role_index = ['main', 'support', 'organ'].index(role)
        native_id = variants[(series['id'], native)]['materialRoles'][role_index]
        base = native_id if native_id.startswith('mat.') else f'mat.{slug}.{role}'
        rank = int(rank_label[1:])
        material_map[mid] = base if rank == native else f'{base}.r{rank}'
    materials = []
    for old in source['materials']:
        m = copy.deepcopy(old); m['sourceId'] = m['id']; m['id'] = material_map[m['id']]
        m['isImplemented'] = m['id'] in runtime_items
        if m['isImplemented']: m['sourceRecord'] = runtime_items[m['id']]
        materials.append(m)
    cap = action_capabilities()
    write('data/action-capabilities.json', {'families': cap, 'tags': TAGS, 'events': EVENTS,
        'note': '動作タグは同一行動内の積集合。draw_attackは抜刀開始、chargeは実際に1段以上解放した場合だけ。文脈タグは命中直前。'})
    mechanics = []; bindings = []; appearance = []; series_files = []
    for b in blueprints:
        mechanics.append(b['signature'])
        for family in FAMILIES:
            d = bind_trait(b, family, cap[family]); mechanics.append(d)
            bindings.append({'speciesId': b['speciesId'], 'family': family, 'mechanicId': d['id'], 'adaptations': d['adaptations']})
    # Shards keep every network write bounded and every definition readable in GitHub.
    for n in range(0, len(mechanics), 20):
        write(f'data/mechanics/{n // 20 + 1:02d}.json', mechanics[n:n + 20], compact=True)
    write('data/weapon-trait-bindings.json', bindings, compact=True)
    for series in source['series']:
        sid = series['id']; species_id = series['sourceSpeciesId']; slug = sid.split('.')[-1]
        b = by_species.get(species_id); is_monster = bool(b)
        group = {'seriesId': sid, 'sourceSpeciesId': species_id, 'name': series['name'], 'seriesName': series['seriesName'], 'nativeRank': series['nativeRank'],
                 'runtimeImportable': False, 'blueprint': f'../species/{b["no"]:03d}-{slug}.json' if b else None,
                 'weapons': [], 'armor': [], 'recipes': [], 'ranks': []}
        for old in [w for w in source['weaponCandidates'] if w['seriesId'] == sid]:
            if b:
                s = b['stats']; rank = old['rank']; family = old['family']
                w = {k: copy.deepcopy(old[k]) for k in ['id', 'seriesId', 'name', 'family', 'rank', 'elements', 'status', 'sharpnessModifier']}
                w.update({'id': id_map[old['id']], 'sourceId': old['id'], 'attack': rounded(baseline[(rank, family)] * s['rawScale'] * s['familyBias'][family]),
                    'affinity': s['affinity'], 'elementValue': rounded(old['elementValue'] * s['elementScale']),
                    'status': 'para' if old['status'] == 'paralysis' else old['status'], 'statusPotency': round(old['statusPotency'] * s['statusScale'], 2),
                    'edgeCapacityScale': s['edgeCapacityScale'], 'edgeWearScale': s['edgeWearScale'], 'combatStaminaScale': s['staminaCostScale'],
                    'traitId': f'weapon_trait.{slug}.{family}', 'appearanceId': f'appearance.{slug}.r{rank}',
                    'runtimeExists': id_map[old['id']] in runtime_weapons, 'runtimeStatsApplied': False})
            else:
                w = copy.deepcopy(old)  # Gathering proposal is intentionally unchanged from PR15.
            group['weapons'].append(w)
        for old in [a for a in source['armorCandidates'] if a['seriesId'] == sid]:
            if b:
                s = b['stats']; rank = old['rank']; slot = old['slot']; total = rounded([0, 30, 65, 105, 150][rank] * s['defenseScale'])
                a = {k: copy.deepcopy(old[k]) for k in ['id', 'seriesId', 'name', 'slot', 'rank', 'armorClass']}
                a.update({'id': id_map[old['id']], 'sourceId': old['id'], 'defense': apportion(total, s['slotWeights'])[slot],
                          'resistances': {e: s['setResistances'][e] // 5 for e in ELEMENTS},
                          'skill': {**b['commonSkills'][slot], 'points': 1}, 'signatureId': b['signature']['id'],
                          'appearanceId': f'appearance.{slug}.r{rank}', 'runtimeExists': id_map[old['id']] in runtime_armor, 'runtimeStatsApplied': False})
            else: a = copy.deepcopy(old)
            group['armor'].append(a)
        for old in [r for r in source['recipes'] if r['seriesId'] == sid]:
            if not b:
                group['recipes'].append(copy.deepcopy(old)); continue
            result = id_map[old['resultId']]; live = recipes_by_result.get(result)
            if live:
                r = {'id': live['id'], 'seriesId': sid, 'rank': old['rank'], 'resultId': result, 'itemType': old['itemType'],
                     'fromId': live.get('fromWeaponId', live.get('fromArmorId')), 'money': live['cost']['money'],
                     'ingredients': [{'materialId': x['itemId'], 'count': x['count']} for x in live['cost']['items']],
                     'kind': live['kind'], 'runtimeExists': True, 'sourceRecord': copy.deepcopy(live), 'nonHuntMaterialsOnly': False}
            else:
                r = copy.deepcopy(old); r['sourceId'] = r['id']; r['resultId'] = result
                r['id'] = f'recipe.{r["kind"].replace("existing_", "")}.{result}'
                r['fromId'] = id_map.get(r['fromId'], r['fromId'])
                r['ingredients'] = [{**x, 'materialId': material_map[x['materialId']]} for x in r['ingredients']]
                r['runtimeExists'] = False
            group['recipes'].append(r)
        for rank in range(series['nativeRank'], 5):
            old = variants[(sid, rank)]; v = copy.deepcopy(old)
            if b:
                v['materialRoles'] = [material_map[x] for x in v['materialRoles']]
                armor = [a for a in group['armor'] if a['rank'] == rank]
                v['setDefense'] = sum(a['defense'] for a in armor); v['defenseBySlot'] = {a['slot']: a['defense'] for a in armor}
                v['resistancePerPiece'] = armor[0]['resistances']; v['appearance'] = b['appearance']['gradeEvolution'][str(rank)]
                v['runtimeExists'] = all(a['runtimeExists'] for a in armor)
                appearance.append({'id': f'appearance.{slug}.r{rank}', 'speciesId': species_id, 'rank': rank,
                    'armorIds': [a['id'] for a in armor], 'weaponIds': [w['id'] for w in group['weapons'] if w['rank'] == rank],
                    'blueprint': group['blueprint'], 'grade': v['appearance'], 'status': '制作仕様。専用3Dモデル未実装'})
            group['ranks'].append(v)
        filename = f'{b["no"]:03d}-{slug}.json' if b else f'G{series["no"]:02d}-{slug}.json' if isinstance(series['no'], int) else f'{series["no"]}-{slug}.json'
        write('data/equipment/' + filename, group, compact=True)
        series_files.append({'path': 'equipment/' + filename, 'seriesId': sid, 'category': 'monster' if b else 'gathering',
                             'weapons': len(group['weapons']), 'armor': len(group['armor']), 'recipes': len(group['recipes'])})
    for n in range(0, len(materials), 50): write(f'data/materials/{n//50+1:02d}.json', materials[n:n+50], compact=True)
    for n in range(0, len(appearance), 25): write(f'data/appearance/{n//25+1:02d}.json', appearance[n:n+25], compact=True)
    counts = {'species': 86, 'gatheringSeries': 9, 'seriesRanks': len(variants), 'monsterSeriesRanks': len(appearance),
              'weapons': sum(s['weapons'] for s in series_files), 'armor': sum(s['armor'] for s in series_files),
              'recipes': sum(s['recipes'] for s in series_files), 'materials': len(materials),
              'signatures': 86, 'weaponTraits': len(bindings), 'mechanics': len(mechanics),
              'adaptedWeaponTraits': sum(bool(b['adaptations']) for b in bindings)}
    write('data/index.json', {'format': 'kari-equipment-specialization-v3-sharded', 'runtimeImportable': False,
        'note': '前回失われた原本の再構築版。旧94ファイルとバイト同一ではない。採集9系列はPR15のまま。',
        'counts': counts, 'series': series_files, 'mechanics': [f'mechanics/{n//20+1:02d}.json' for n in range(0,len(mechanics),20)],
        'materials': [f'materials/{n//50+1:02d}.json' for n in range(0,len(materials),50)],
        'appearance': [f'appearance/{n//25+1:02d}.json' for n in range(0,len(appearance),25)]})
    write('data/design-contract.json', {'tickRate': 60, 'families': FAMILIES, 'slots': SLOTS, 'elements': ELEMENTS,
        'events': EVENTS, 'tags': TAGS, 'effectCaps': CAPS, 'commonMaxLevel': 3, 'signaturePieceThresholds': {'2': 1, '4': 2},
        'commonSkills': read(ROOT / 'public/data/skills.json')['skills'], 'attackOriginExcluded': True,
        'effectDuration': '[activationTick, activationTick+durationTicks)', 'counterWindow': 'event.tick-mark.tick < windowTicks',
        'perActionContributions': 1, 'cooldownOrigin': 'activation', 'resetRefundsCooldown': False,
        'materializationCommand': 'python3 reference/materialize_catalog.py --output /absolute/output.json'})
    write('analysis/id-map.json', {'equipment': id_map, 'materials': material_map}, compact=True)
    source_paths = ['docs/source/chatgpt-equipment-20261125/data/all-equipment.json', 'public/data/bestiary.json',
                    'public/data/weapons.json', 'public/data/armor.json', 'public/data/equipment_series.json', 'public/data/recipes.json',
                    'public/data/items.json', 'public/data/items_creatures.json', 'public/data/skills.json', 'src/game/gear.ts', 'src/game/sim.ts']
    write('analysis/source-manifest.json', {'sourceCommit': SOURCE_COMMIT,
        'version': read(ROOT / 'package.json')['version'], 'files': [{'path': p, 'sha256': hashlib.sha256(source_bytes(p)).hexdigest()} for p in source_paths],
        'counts': counts, 'oldUnpublishedTree': '31efccb0db89ce14f489f5cb37062e8c93687081', 'byteIdenticalRecovery': False})
    write('analysis/static-balance-index.json', [{'no': b['no'], 'name': b['name'], 'rawScale': b['stats']['rawScale'], 'affinity': b['stats']['affinity'],
        'expectedRawBeforeMotion': round(b['stats']['rawScale']*(1+b['stats']['affinity']/400), 4),
        'defenseScale': b['stats']['defenseScale'], 'elementScale': b['stats']['elementScale'], 'statusScale': b['stats']['statusScale'],
        'caveat': '静的比較。実戦DPS/生存率ではない。発動率・肉質・持ち替え・拘束・素材供給は含まない。'} for b in blueprints])
    print(json.dumps(counts, ensure_ascii=False))

if __name__ == '__main__': main()
