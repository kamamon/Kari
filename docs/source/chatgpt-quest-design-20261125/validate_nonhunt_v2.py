"""Reference, quantity and compatibility checks for design data; not a game test."""
from pathlib import Path
from collections import Counter
import json,hashlib,subprocess

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def read(name):return json.loads((HERE/name).read_text())
catalog=read('nonhunt_catalog_v2.json')
resources=read('resources_v2.json')
manifest=read('source_manifest_v2.json')
quests=catalog['quests'];old=read('quest_catalog_v1.json')['quests']
allq={q['questId']:q for q in old+quests}
res={r['id']:r for r in resources['resources']+resources['externalReferences']}
errors=[];checks=Counter()
def check(ok,group,msg):
    checks[group]+=1
    if not ok:errors.append(msg)
def source(path):return subprocess.check_output(['git','show',manifest['baselineCommit']+':'+path],cwd=REPO)
bi=json.loads(source('public/data/bestiary.json'))
fields={f['name'] for f in bi['fields']}|{'里'}
items=json.loads(source('public/data/items.json'))
known={i['id']:i for i in items['items']+items['materials']}
story={q['storyId']:q['questId'] for q in read('story_quest_map_v1.json')['storyQuests']}
gate={'根絡み湿原':'ST04','硝砂海岸':'ST06','灰鐘鉱山':'ST08','氷帆峡谷':'ST10','霧灯樹海':'ST12','重霧環谷':'ST14'}
check(len(quests)==36 and len(allq)==138,'inventory','36 additions / 138 unique IDs')
check(Counter(q['subtype'] for q in quests)=={'gather':12,'mining':12,'field_collection':4,'cargo_transport':4,'warehouse':4},'inventory','type counts')
check(len(resources['resources'])==28 and len(res)==29,'inventory','24 natural / 4 cargo / 1 existing resource')
check(len({q['recordLabel'] for q in old+quests})==138,'inventory','record labels unique')
check(len({r['name'] for r in resources['resources']})==28,'inventory','resource names unique')
bag=catalog['policies']['bag']
supplied=0;required=0
for q in quests:
    key=q['questId'];stock=q['subtype']=='warehouse';cargo=q['subtype']=='cargo_transport'
    check(not q['availableAfterDesignMerge'] and not q['runtimeContentExists'],'readiness',key+' status')
    check(q['successRequiresMonsterKill'] is False and q['killOrCaptureCanComplete'] is False,'objective',key+' accidental kill success')
    check(q['fieldName'] in fields,'references',key+' field')
    check(1<=q['stars']<=4 and isinstance(q['stars'],int),'stars',key+' stars')
    check(100<=len(q['requestText'])<=200,'copy',key+' copy length')
    check(bool(q['client']) and bool(q['objectiveText']) and len(q['difficultyReasons'])>=2,'copy',key+' missing copy')
    check(q['rewardMoney']>0 and q['rewardItems']==[],'economy',key+' rewards')
    check('targetMonsterId' not in q and 'targets' not in q,'objective',key+' dummy monster schema')
    check(len(q['requirements'])==len({r['resourceId'] for r in q['requirements']}),'objective',key+' repeated requirements')
    for r in q['requirements']:
        rid=r['resourceId'];check(rid in res,'references',key+' resource '+rid)
        check(isinstance(r['count'],int) and r['count']>0,'quantities',key+' required count')
        check(r['resourceName']==res[rid]['name'] and r['unit']==res[rid]['unit'],'copy',key+' resource display')
        check(r['resourceName'] in q['objectiveText'],'copy',key+' objective resource name')
        if not stock:check(res[rid]['fieldName']==q['fieldName'],'references',key+' foreign resource node')
    for pre in q['requires']:check(pre in allq,'references',key+' missing prerequisite '+pre)
    check(len(q['requires'])==len(set(q['requires'])),'progression',key+' repeated gate')
    if q['unlockStoryId']:
        check(q['unlockStoryId'] in story and story[q['unlockStoryId']] in q['requires'],'progression',key+' story linkage')
    if q['fieldName'] in gate:
        check(q['unlockStoryId']==gate[q['fieldName']],'progression',key+' regional gate')
    if q['encounterPolicy']=='none':
        check(q['spawnLargeMonsters'] is False and q['spawnJuveniles'] is False,'encounters',key+' safe encounter')
    if stock:
        check(q['effectiveTimeLimitMinutes'] is None and q['effectiveTimeLimitTicks'] is None and q['targetClearMinutes'] is None and q['maxFaints'] is None,'warehouse',key+' no field clock')
        check(q['targetTransactionSeconds']==[15,30] and q['stars']==1,'warehouse',key+' transaction scale')
        check(q['repeatPolicy']=='once_per_save' and q['claimId']==key,'warehouse',key+' permanent claim')
        check(q['itemProvenance']=='warehouse' and q['preownedMaterialsConsumed'] is True and q['supplies']==[],'warehouse',key+' inventory provenance')
        check(q['completionTrigger']=='atomic_warehouse_trade','warehouse',key+' completion')
        for r in q['requirements']:check(r['reserveFloor']>0,'warehouse',key+' reserve missing')
        check(q.get('materialAcquisitionDifficulty') in ['初級','中級','上級','極級'],'warehouse',key+' acquisition hint')
    else:
        lo,hi=q['targetClearMinutes']
        check(0<lo<=hi<q['effectiveTimeLimitMinutes'],'time',key+' target range')
        check(q['effectiveTimeLimitMinutes']=={1:15,2:20,3:25,4:30}[q['stars']],'time',key+' star time table')
        check(q['effectiveTimeLimitTicks']==q['effectiveTimeLimitMinutes']*3600,'time',key+' effective ticks')
        check(q['maxFaints']==3 and q['returnDelaySeconds']==5,'time',key+' fail/return')
        check(q['repeatPolicy']=='repeatable' and q['claimId'] is None,'progression',key+' repeat policy')
        check(q['supplies']==[{'itemId':'item.heal_tonic','count':3},{'itemId':'item.whetstone','count':1}],'supplies',key+' supplies')
        for s in q['supplies']:check(s['itemId'] in known and s['count']<=known[s['itemId']]['carryMax'],'supplies',key+' known supply')
        check(not q['preownedMaterialsConsumed'],'inventory',key+' consumes owned materials')
        if cargo:
            check(q['itemProvenance']=='loaned_cargo' and q['completionTrigger']=='all_cargo_accepted','cargo',key+' provenance')
            check(q['transportRounds']==sum(r['count'] for r in q['requirements'])==len(q['cargoUnits']),'cargo',key+' unit count')
            cp=q['cargoPolicy'];check(cp['maxCarried']==1 and cp['moveSpeedScale']==0.85 and not cp['breakable'] and cp['dodgeAllowed'],'cargo',key+' carry mechanics')
            check(all(not res[r['resourceId']]['ordinaryInventoryAllowed'] for r in q['requirements']),'cargo',key+' cargo in warehouse')
        else:
            check(q['itemProvenance']=='current_run_nodes' and q['completionTrigger']=='all_requirements_deposited_together','collection',key+' provenance')
            check(len(q['requirements'])<=bag['distinctSlots'],'bag',key+' too many resource types')
            nodes={p['resourceId']:p for p in q['nodePlan']}
            check(set(nodes)=={r['resourceId'] for r in q['requirements']},'collection',key+' node coverage')
            for r in q['requirements']:
                p=nodes[r['resourceId']];n=p['nodeCount']*p['guaranteedYieldPerNode']*p['chargesPerNode']
                supplied+=n;required+=r['count']
                check(p['guaranteedYieldPerNode']==2 and p['chargesPerNode']==1,'collection',key+' node yield')
                check(n>=r['count']+2,'collection',key+' guaranteed supply')
                check(n<=bag['perResourceMax'],'bag',key+' supply exceeds bag')
                check(q['questId'] in res[r['resourceId']]['sourceQuestIds'],'references',key+' missing resource source')

for r in resources['resources']:
    check(not r['isImplemented'] and not r['recipeImplemented'],'readiness',r['id']+' implemented')
    check(not r['shopPurchaseEnabled'] and not r['shopSaleEnabled'],'economy',r['id']+' vendor loop')
    check(bool(r['sourceQuestIds']),'references',r['id']+' no obtaining route')
    for qid in r['sourceQuestIds']:check(qid in allq,'references',r['id']+' missing obtaining quest')
for r in resources['externalReferences']:
    check(r['id'] in known and known[r['id']]['name']==r['name'],'references',r['id']+' existing material mismatch')

# Every new prerequisite points only into the unchanged story/hunting catalog.
oldids={q['questId'] for q in old}
check(all(set(q['requires'])<=oldids for q in quests),'progression','new quests cannot introduce a story prerequisite cycle')
for p in manifest['preservedV1Files']:
    check(hashlib.sha256((HERE/p['path']).read_bytes()).hexdigest()==p['sha256'],'v1_preservation',p['path']+' changed locally')
    remote=subprocess.check_output(['git','show',manifest['priorDesignCommit']+':chatgpt-inbox/quest-design-20261125/'+p['path']],cwd=REPO)
    check(hashlib.sha256(remote).hexdigest()==p['sha256'],'v1_preservation',p['path']+' differs from submitted v1')
for s in manifest['sources']:check(hashlib.sha256(source(s['path'])).hexdigest()==s['sha256'],'source_hashes',s['path']+' baseline hash')
idx=read('combined_quest_index_v2.json')['quests']
check(len(idx)==138 and {q['questId'] for q in idx}==set(allq),'inventory','combined index coverage')
for q in idx:
    expected='quest_catalog_v1.json' if q['questId'] in oldids else 'nonhunt_catalog_v2.json'
    check(q['sourceFile']==expected and q['title']==allq[q['questId']]['title'],'inventory',q['questId']+' index target')

report={'status':'pass' if not errors else 'fail','scope':'design data, source references and arithmetic only; no game test or playtest','baselineCommit':manifest['baselineCommit'],'additionalQuestCount':36,'combinedQuestCount':138,'countsBySubtype':dict(Counter(q['subtype'] for q in quests)),'stars':dict(sorted(Counter(q['stars'] for q in quests).items())),'newNaturalResources':24,'loanedCargoTypes':4,'fieldQuests':32,'warehouseQuests':4,'guaranteedResourceUnitsAcrossQuestLayouts':supplied,'requiredResourceUnitsAcrossQuestLayouts':required,'totalAssertions':sum(checks.values()),'assertionCounts':dict(checks),'errors':errors,'notTested':['採取点と地形の実配置・到達可能性','実際のクリア時間と回避難度','iPhoneの操作と表示','納品・貨物・袋・保存の新実装','倉庫納品の同時更新・保存失敗','未実装地域と自然素材の見た目']}
(HERE/'validation_report_v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
