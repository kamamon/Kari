#!/usr/bin/env python3
"""Check coverage, usable skill conditions, source preservation, recipes and all grade values."""
import collections
import json
import math
import pathlib
import sys
from generate_catalog import PACKAGE, ROOT, SOURCE, FAMILIES, SLOTS, ELEMENTS, CAPS, ACTION_TAGS, EVENTS, TAGS, read, write, matching_actions

checks = collections.Counter()
errors = []
def check(condition, message, category='schema'):
    checks[category] += 1
    if not condition: errors.append(message)

def main():
    source = read(SOURCE)
    registry = {s['id']: s for s in read(ROOT/'public/data/bestiary.json')['species']}
    original = {s['sourceSpeciesId']: s for s in source['series'] if s['sourceSpeciesId']}
    blueprints = [read(p) for p in sorted((PACKAGE/'data/species').glob('*.json'))]
    index = read(PACKAGE/'data/index.json')
    groups = [read(PACKAGE/'data'/x['path']) for x in index['series']]
    mechanics = [x for p in index['mechanics'] for x in read(PACKAGE/'data'/p)]
    materials = [x for p in index['materials'] for x in read(PACKAGE/'data'/p)]
    appearances = [x for p in index['appearance'] for x in read(PACKAGE/'data'/p)]
    by_mechanic = {m['id']: m for m in mechanics}
    weapons = [x for g in groups for x in g['weapons']]
    armor = [x for g in groups for x in g['armor']]
    recipes = [x for g in groups for x in g['recipes']]
    caps = read(PACKAGE/'data/action-capabilities.json')['families']
    commons = {x['id']: x for x in read(ROOT/'public/data/skills.json')['skills']}
    check(len(blueprints)==86, '86 blueprints required', 'coverage')
    check({b['speciesId'] for b in blueprints}==set(registry), 'Species registry coverage differs', 'coverage')
    check(len(mechanics)==688, '688 mechanics required', 'coverage')
    check(len(weapons)==1750 and len(armor)==1250 and len(recipes)==3000, '3000 equipment/recipes required', 'coverage')
    check(len(materials)==583, '583 materials required', 'coverage')
    check(len(appearances)==214, '214 species/rank appearances required', 'coverage')
    signatures = []
    for b in blueprints:
        name = f'{b["no"]:03d} {b["name"]}'; old = original[b['speciesId']]; reg = registry[b['speciesId']]
        check(b['no']==reg['no'] and b['name']==reg['name'] and b['nativeRank']==old['nativeRank'], name+' identity mismatch', 'coverage')
        for field in ('role','ecologyBasis','combatLoop','strength','weakness','avoidUse'):
            check(isinstance(b['identity'].get(field),str) and len(b['identity'][field])>=8, name+' '+field)
        s=b['stats']
        bounds={'rawScale':(.78,1.16),'affinity':(-20,30),'edgeCapacityScale':(.7,1.3),'edgeWearScale':(.8,1.5),'staminaCostScale':(.9,1.2),'defenseScale':(.75,1.1)}
        for field,(lo,hi) in bounds.items(): check(lo<=s[field]<=hi,name+' '+field)
        check(.65<=s['elementScale']<=1.85 if old['elements'] else s['elementScale']==0, name+' source element changed')
        check(.7<=s['statusScale']<=1.6 if old['status'] else s['statusScale']==0, name+' source status changed')
        check(set(s['familyBias'])==set(FAMILIES),name+' family bias coverage')
        for value in s['familyBias'].values(): check(.96<=value<=1.04,name+' family bias bounds')
        check(set(s['slotWeights'])==set(SLOTS) and abs(sum(s['slotWeights'].values())-1)<1e-9,name+' slot weights')
        for value in s['slotWeights'].values(): check(.1<=value<=.35,name+' slot weight bounds')
        check(set(s['setResistances'])==set(ELEMENTS),name+' resist coverage')
        for element,value in s['setResistances'].items(): check(-30<=value<=25 and value%5==0,name+' resistance '+element)
        for element in old['weak']: check(s['setResistances'][element]<0,name+' source weakness '+element)
        for element in old['resist']: check(s['setResistances'][element]>0,name+' source resistance '+element)
        check(set(b['commonSkills'])==set(SLOTS),name+' common slots')
        points=collections.Counter()
        for slot, skill in b['commonSkills'].items():
            sid=skill['id'];params=skill.get('parameters',{});key=(sid,json.dumps(params,sort_keys=True));points[key]+=1
            check(sid in commons,name+' unknown common '+sid)
            if sid=='status_resistance': check(params.get('status') in ['poison','para','sleep','stun'],name+' status resistance parameter')
            elif sid=='element_resistance': check(params.get('element') in ELEMENTS,name+' element resistance parameter')
            else: check(params=={},name+' unexpected common parameter')
            if sid=='element_tuning': check(bool(old['elements']),name+' inert element tuning')
            if sid=='status_tuning': check(bool(old['status']),name+' inert status tuning')
        check(max(points.values())<=3,name+' wasted common points')
        a=b['appearance']
        check(len(a['palette'])==3 and len(a['organTranslation'])>=3,name+' organ/palette')
        check(set(a['weaponShapes'])==set(FAMILIES),name+' seven shapes')
        check(set(a['armorParts'])==set(SLOTS),name+' five parts')
        check(set(a['gradeEvolution'])=={str(r) for r in range(b['nativeRank'],5)},name+' grade evolution')
        for value in list(a['weaponShapes'].values())+list(a['armorParts'].values()): check(isinstance(value,str) and len(value)>=8,name+' shape detail')
        check(len(a['avoid'])>=3 and a['skillCue']['maxLitSurfacePercent']<=8,name+' light/negative constraints')
        for key in ('primaryForm','secondaryForm','dominantRegion','asymmetry','repeatCount','jointClearance','gripRule'): check(key in a['production'],name+' production '+key)
        check(b['signature']['id']=='signature.'+b['speciesId'].split('.')[-1],name+' signature id')
        check(b['weaponTrait']['id']=='weapon_trait.'+b['speciesId'].split('.')[-1],name+' trait id')
        sig=b['signature'];signatures.append(json.dumps({k:v for k,v in sig.items() if k not in ['id','name','explanation']},sort_keys=True))
        for family in b['identity']['recommendedFamilies']:
            check(family in FAMILIES,name+' unknown recommended family','compatibility')
            c=caps[family]; t=sig['trigger']
            check(t['event'] in c['events'],name+' signature event unavailable for '+family,'compatibility')
            if t['event'] in ('hit','charge_release','part_break','status_inflicted') or set(t['tagsAll']+t['tagsAny'])&ACTION_TAGS:
                check(bool(matching_actions(sig,c)),name+' signature tags cannot coexist for '+family,'compatibility')
            if any(e['stat']=='guardCostPct' for e in sig['effects']): check('guard' in c['events'],name+' signature guard effect inert for '+family,'compatibility')
            if any(e['stat']=='edgeWearPct' for e in sig['effects']): check(family!='ring_bow',name+' signature edge effect inert for bow','compatibility')
            if any(e['stat']=='stunPct' for e in sig['effects']): check(any('blunt' in action['tags'] for action in c['actions']),name+' stun effect inert for '+family,'compatibility')
        for family in FAMILIES:
            m=by_mechanic[f'weapon_trait.{b["speciesId"].split(".")[-1]}.{family}'];t=m['trigger']
            check(t['event'] in caps[family]['events'],name+' trait event '+family,'compatibility')
            if t['event'] in ('hit','charge_release','part_break','status_inflicted') or set(t['tagsAll']+t['tagsAny'])&ACTION_TAGS:
                check(bool(matching_actions(m,caps[family])),name+' trait action intersection '+family,'compatibility')
    check(len(signatures)==len(set(signatures)), 'Mechanically duplicate signatures', 'uniqueness')
    check(len({b['signature']['name'] for b in blueprints})==86,'Duplicate signature names','uniqueness')
    for m in mechanics:
        t=m['trigger']; ident=m['id']; is_trait=ident.startswith('weapon_trait.')
        check(t['event'] in EVENTS,ident+' unknown event','mechanics')
        for tag in t['tagsAll']+t['tagsAny']: check(tag in TAGS,ident+' unknown tag '+tag,'mechanics')
        check(not {'broken','unbroken'}<=set(t['tagsAll']),ident+' conflicting state tags','mechanics')
        check(0<=t['hpMin']<=t['hpMax']<=100 and 0<=t['staminaMin']<=t['staminaMax']<=100,ident+' condition range','mechanics')
        check(1<=m['hitsRequired']<=5 and isinstance(m['hitsRequired'],int),ident+' hit count','mechanics')
        check(120<=m['windowTicks']<=600 and 60<=m['durationTicks']<=600 and m['cooldownTicks']>=max(180,m['durationTicks']),ident+' time bounds','mechanics')
        check(set(m['resetOn'])<={'damage_taken','sheathe','target_change'},ident+' reset kinds','mechanics')
        check(1<=len(m['effects'])<=(1 if is_trait else 2),ident+' effect count','mechanics')
        check(len({e['stat'] for e in m['effects']})==len(m['effects']),ident+' duplicate channel','mechanics')
        for e in m['effects']:
            stat=e['stat']; values=e['values']; check(stat in CAPS and len(values)==2,ident+' effect schema','mechanics')
            if stat not in CAPS: continue
            for v in values:
                check(isinstance(v,(int,float)) and math.isfinite(v) and CAPS[stat][0]<=v<=CAPS[stat][1],ident+' channel bounds '+stat,'mechanics')
                if stat in ('rawPct','elementPct','statusPct','affinityPoints'):
                    cap = {'rawPct':4 if is_trait else 10,'elementPct':6 if is_trait else 16,'statusPct':6 if is_trait else 16,'affinityPoints':4 if is_trait else 12}[stat]
                    check(v<=cap,ident+' mechanic bonus cap '+stat,'mechanics')
                if stat in ('guardCostPct','dodgeCostPct','edgeWearPct','itemUseTicksPct'): check(v>=(-8 if is_trait else -20),ident+' cost reduction cap','mechanics')
            if is_trait: check(values[0]==values[1],ident+' trait has two levels','mechanics')
        if t['event'] in ('sheathe','draw','item_used','dodge','guard','parry','damage_taken'):
            check(not (set(t['tagsAll']+t['tagsAny'])&ACTION_TAGS),ident+' action tags attached to nonattack event','mechanics')
        if t['event']=='charge_release': check(set(t['tagsAll']+t['tagsAny'])<={'charge'},ident+' release has unresolvable target/hit tags','mechanics')
    for label, rows in [('weapons',weapons),('armor',armor),('recipes',recipes),('materials',materials),('mechanics',mechanics),('appearance',appearances)]:
        check(len(rows)==len({x['id'] for x in rows}),label+' duplicate ids','uniqueness')
    all_items={x['id']:x for x in weapons+armor}; mat_ids={m['id'] for m in materials}
    runtime_extra=read(ROOT/'public/data/equipment_series.json')
    runtime_weapons=read(ROOT/'public/data/weapons.json')['weapons']+runtime_extra['weapons']
    runtime_armor=read(ROOT/'public/data/armor.json')['armor']+runtime_extra['armor']
    runtime_ids={x['id'] for x in runtime_weapons+runtime_armor}
    runtime_recipes=read(ROOT/'public/data/recipes.json')['recipes']+runtime_extra['recipes']
    runtime_by_result={r.get('resultWeaponId',r.get('resultArmorId')):r for r in runtime_recipes}
    output_by_result={r['resultId']:r for r in recipes}
    current_monster={i for i in runtime_ids if not i.endswith('.001')}
    check(len(current_monster)==384,'Runtime monster item count changed: audit required','preservation')
    for item_id in current_monster:
        check(item_id in all_items,item_id+' missing runtime item','preservation')
        old=runtime_by_result[item_id];new=output_by_result[item_id]
        check(new['sourceRecord']==old,item_id+' runtime recipe changed','preservation')
    for item in weapons+armor:
        if item['seriesId'].startswith('series.'):
            check(item['runtimeExists']==(item['id'] in runtime_ids),item['id']+' stale runtime flag','honesty')
            check(item['runtimeStatsApplied'] is False,item['id']+' claims integrated stats','honesty')
    for group in groups:
        sid=group['seriesId'];native=group['nativeRank'];expected=4-native+1
        check(len(group['weapons'])==7*expected and len(group['armor'])==5*expected and len(group['recipes'])==12*expected,sid+' grade coverage','coverage')
        for rank in range(native,5):
            ws=[w for w in group['weapons'] if w['rank']==rank];aa=[a for a in group['armor'] if a['rank']==rank]
            check({w['family'] for w in ws}==set(FAMILIES) and {a['slot'] for a in aa}==set(SLOTS),sid+' slot/family coverage','coverage')
            v=next(x for x in group['ranks'] if x['rank']==rank)
            check(sum(a['defense'] for a in aa)==v['setDefense'],sid+' defense sum','numeric')
            if rank>native:
                for w in ws: check(w['attack']>next(x['attack'] for x in group['weapons'] if x['rank']==rank-1 and x['family']==w['family']),w['id']+' nonincreasing attack','numeric')
                for a in aa: check(a['defense']>next(x['defense'] for x in group['armor'] if x['rank']==rank-1 and x['slot']==a['slot']),a['id']+' nonincreasing defense','numeric')
        if sid.startswith('gathering.'):
            for key,old_key in [('weapons','weaponCandidates'),('armor','armorCandidates'),('recipes','recipes')]:
                check(group[key]==[x for x in source[old_key] if x['seriesId']==sid],sid+' gathering data changed','preservation')
    for r in recipes:
        result=r['resultId'];check(result in all_items,r['id']+' missing result','recipes')
        check(r['money']>=0 and isinstance(r['money'],int),r['id']+' money','recipes')
        for ing in r['ingredients']:
            check(ing['materialId'] in mat_ids,r['id']+' missing material '+ing['materialId'],'recipes')
            check(isinstance(ing['count'],int) and ing['count']>0,r['id']+' material count','recipes')
            if r['nonHuntMaterialsOnly']:
                check(next(m for m in materials if m['id']==ing['materialId'])['acquisition']!='monster',r['id']+' hunt ingredient','recipes')
        if r['fromId']:
            check(r['fromId'] in all_items or r['fromId'] in runtime_ids,r['id']+' missing predecessor','recipes')
            if r['fromId'] in all_items:
                check(all_items[r['fromId']]['rank']==r['rank']-1 and all_items[r['fromId']]['seriesId']==r['seriesId'],r['id']+' invalid upgrade edge','recipes')
    report={'checks':sum(checks.values()),'categories':dict(checks),'errorCount':len(errors),'errors':errors,
            'counts':index['counts'],'scope':'静的整合性・実装可能条件・既存データ保全。実戦バランス、端末描画、3D可動域は未検証。'}
    write('analysis/validation-report.json',report)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=='__main__': sys.exit(main())
