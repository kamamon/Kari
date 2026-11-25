"""Validate proposal references and arithmetic. This does not run the game."""
from pathlib import Path
from collections import Counter
import json
import hashlib

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]

def read(p):return json.loads(p.read_text())
errors=[]
checks=Counter()
def check(ok,group,message):
    checks[group]+=1
    if not ok:errors.append(message)

bestiary=read(REPO/'public/data/bestiary.json')
species={s['id']:s for s in bestiary['species']}
fields={f['name'] for f in bestiary['fields']}
item_ids={i['id'] for i in read(REPO/'public/data/items.json')['items']}
catalog=read(HERE/'quest_catalog_v1.json')
quests=catalog['quests']
qid={q['questId']:q for q in quests}
check(len(quests)==len(qid)==102,'inventory','102 unique quests required')
check(Counter(q['category'] for q in quests)=={'existing':24,'future_species':66,'new_story':12},'inventory','category count differs')
check({t['speciesId'] for q in quests for t in q['targets']}==set(species),'inventory','86 species coverage differs')
check(all(not q['availableAfterDesignMerge'] for q in quests),'readiness','proposal cannot enable quests')
for q in quests:
    key=q['questId']
    check(isinstance(q['stars'],int) and 1<=q['stars']<=8,'stars',key+' star range')
    lo,hi=q['targetClearMinutes']
    check(0<lo<=hi<q['effectiveTimeLimitMinutes'],'time',key+' target / limit')
    check(q['effectiveTimeLimitTicks']==q['effectiveTimeLimitMinutes']*3600,'time',key+' final ticks')
    check(q['fieldName'] in fields,'references',key+' field')
    check(90<=len(q['requestText'])<=220,'copy',key+' copy length')
    check(q['maxFaints']==3,'failure',key+' faints')
    for item in q['supplies']+q.get('captureSupplyAdditionsIfImplemented',[]):
        check(item['itemId'] in item_ids and item['count']>0,'supplies',key+' supply item')
    for t in q['targets']:
        check(t['speciesId'] in species,'references',key+' species id')
        if t['speciesId'] in species:
            sp=species[t['speciesId']]
            check(t['speciesName']==sp['name'],'references',key+' species name')
            if sp['class'] in ['juvenile','huge']:
                check(q['objectiveKind']=='slay','capture',key+' noncapture class')
    if q['category']!='existing':
        check(q['supplies']==[{'itemId':'item.heal_tonic','count':5},{'itemId':'item.whetstone','count':3}],'supplies',key+' base supplies')
        expected_capture=[{'itemId':'item.bind_trap','count':1},{'itemId':'item.calm_orb','count':3}] if q['objectiveKind']=='hunt' else []
        check(q['captureSupplyAdditionsIfImplemented']==expected_capture,'supplies',key+' conditional capture supplies')
        check(not q['runtimeContentExists'] and q['combatRankId'] is None,'readiness',key+' future runtime state')
        check(q['capturePolicy'] in ['not_allowed','requires_implementation_and_verification'],'capture',key+' future capture status')

source=[]
for f in ['quests.json','quests_creatures.json','quests_herds.json']:
    source+=read(REPO/'public/data'/f)['quests']
current=read(HERE/'current_quest_overrides_v1.json')['questDesigns']
curid={q['questId']:q for q in current}
check(set(curid)=={q['id'] for q in source},'existing','24 existing IDs')
changed=[]
for src in source:
    q=curid[src['id']]
    for k,old in [('title',src['name']),('objectiveKind',src['kind']),('combatRankId',src['rankId']),('requires',src.get('requires',[])),
                  ('maxFaints',src['maxFaints']),('rewardMoney',src['rewards']['money']),('rewardItems',src['rewards']['items']),('supplies',src['supplies'])]:
        check(q[k]==old,'existing',src['id']+' changed '+k)
    targets=src.get('targets') or [{'monsterId':src['targetMonsterId'],'count':1}]
    check([(t['speciesId'],t['count']) for t in q['targets']]==[(t['monsterId'],t['count']) for t in targets],'existing',src['id']+' targets')
    op=q['runtimeTimeOptions']
    check(op['legacyScaleAdapter']['timeLimitTicks']*2==q['effectiveTimeLimitMinutes']*3600,'timer_adapter',src['id']+' legacy formula')
    check(op['preferredExplicitFieldLimit']['fieldTimeLimitTicks']==q['effectiveTimeLimitMinutes']*3600,'timer_adapter',src['id']+' explicit formula')
    check(op['preferredExplicitFieldLimit']['preserveArenaTimeLimitTicks']==src['timeLimitTicks'],'timer_adapter',src['id']+' arena preservation')
    if q['effectiveTimeLimitMinutes']!=src['timeLimitTicks']*2/3600:changed.append(src['id'])
check(set(changed)=={'quest.basin.r2.001','quest.basin.r3.001','quest.basin.r4.001'},'timer_adapter','only 3 timer changes')

native=read(HERE/'species_native_reference_v1.json')['speciesQuests']
check(len(native)==86,'native_reference','86 native reference copies')
check(len({n['questId'] for n in native})==86,'native_reference','native id uniqueness')
for n in native:
    s=species[n['speciesId']]
    for k,old in [('speciesName',s['name']),('speciesRank',s['rank']),('proposedFieldName',s['habitat'])]:
        check(n[k]==old,'native_reference',n['proposalId']+' '+k)
    check(n['proposalId']=='Q%03d'%s['no'],'native_reference',n['proposalId']+' no')
    band=int(s['rank'][-1])
    check((band-1)*2+1<=n['stars']<=band*2,'stars',n['proposalId']+' tier band')
    if s['class']=='huge':check(n['objectiveKind']=='slay' and n['timeLimitMinutes']==50,'huge',n['proposalId']+' huge rules')
check(sum(species[n['speciesId']]['class']=='huge' for n in native)==10,'huge','10 giants')

story=read(HERE/'story_quest_map_v1.json')['storyQuests']
check([q['storyId'] for q in story]==['ST%02d'%i for i in range(1,15)],'story','story sequence')
check(sum(s['reuseExisting'] for s in story)==2,'story','two reuse')
for s in story:
    check(s['questId'] in qid,'story',s['storyId']+' link')
    q=qid[s['questId']]
    for k in ['title','client','requestText','stars']:
        check(s[k]==q[k],'story',s['storyId']+' differs '+k)
    check(s['prerequisites']==q['requires'],'story',s['storyId']+' prerequisite mismatch')
check(story[12]['speciesId']=='monster.grasedon' and story[12]['speciesRank']=='rank.3','story','ST13 rank')
check(story[13]['speciesId']=='monster.segranio' and story[13]['speciesRank']=='rank.4','story','ST14 identity')

# Proposed optional unlock expressions remain separate from engine requires.
progress=read(HERE/'progression_v1.json')
def refs(expr):
    if 'questCleared' in expr:return [expr['questCleared']]
    if 'uniqueQuestClearsAtLeast' in expr:
        block=expr['uniqueQuestClearsAtLeast']
        check(len(block['candidates'])==5 and len(set(block['candidates']))==5 and block['count']==2,'progression','2 of 5')
        return block['candidates']
    children=expr.get('all',expr.get('any',[]))
    return [r for c in children for r in refs(c)]
groupdeps={}
for rule in progress['rules']:
    groupdeps[rule['groupId']]=refs(rule['expression'])
    check(rule['appliesTo']=='new_quests_only','progression','existing lock')
    for rid in groupdeps[rule['groupId']]:check(rid in qid,'progression','missing '+rid)
deps={q['questId']:list(q['requires'])+groupdeps.get(q['proposedProgressionGroup'],[]) for q in quests}
active=set();done=set()
def visit(key):
    if key in active:
        errors.append('dependency cycle '+key);return
    if key in done:return
    active.add(key)
    for need in deps.get(key,[]):
        check(need in qid,'progression',key+' missing '+need)
        if need in qid:visit(need)
    active.remove(key);done.add(key)
for key in qid:visit(key)
check(len(done)==102,'progression','all nodes traversed')

# Verify each material bundle can pay for each of the seven weapon choices plus five armor pieces.
recipes=read(REPO/'public/data/recipes.json')['recipes']
support=read(HERE/'campaign_support_v1.json')['packs']
check(len(support)==4,'campaign_support','four support milestones')
last_cost=0
for pack in support:
    level=pack['targetEquipmentTier']
    rs=[r for r in recipes if (r.get('resultWeaponId') or r.get('resultArmorId')).endswith('.%03d'%level)]
    weapons=[r for r in rs if r['kind']=='upgrade'];armor=[r for r in rs if r['kind']=='armor_upgrade']
    check(len(weapons)==7 and len(armor)==5,'campaign_support','seven weapon/five armor')
    given=Counter({i['itemId']:i['count'] for i in pack['grantItems']})
    for weapon in weapons:
        required=Counter()
        for r in armor+[weapon]:required.update({i['itemId']:i['count'] for i in r['cost']['items']})
        check(not (required-given),'campaign_support',pack['packId']+' insufficient for '+weapon['id'])
        money=sum(r['cost']['money'] for r in armor+[weapon])
        check(money==pack['costForAnyOneWeaponAndFiveArmor'],'campaign_support',pack['packId']+' fee')
    last_cost+=pack['costForAnyOneWeaponAndFiveArmor']
    check(last_cost==pack['cumulativeUpgradeCost']<=pack['cumulativeStoryFixedMoney'],'campaign_support',pack['packId']+' cumulative money')
    check(pack['grantOnce'] and pack['grantMoney']==0,'campaign_support',pack['packId']+' one-time')

manifest=read(HERE/'source_manifest_v1.json')
for source in manifest['sources']:
    check(hashlib.sha256((REPO/source['path']).read_bytes()).hexdigest()==source['sha256'],'source_hashes',source['path']+' changed')

report={'status':'pass' if not errors else 'fail','scope':'reference / editorial consistency / arithmetic only; no game test or playtest',
        'baselineCommit':catalog['baselineCommit'],'assertionCounts':dict(checks),'totalAssertions':sum(checks.values()),
        'errors':errors,'questCount':102,'coveredSpecies':86,'storyLinks':14,
        'currentTimerChanges':changed,'storyTargetMinutesTotal':[sum(s['targetClearMinutes'][i] for s in story) for i in (0,1)],
        'stars':dict(sorted(Counter(q['stars'] for q in quests).items())),
        'notTested':['実際の勝率・狩猟時間','iPhone表示と性能','新規schema・UI・タイマーのゲーム動作','章の支給と一回限り保存','未実装種・狩場・捕獲・複数大型']}
(HERE/'validation_report_v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
