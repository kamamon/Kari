#!/usr/bin/env python3
"""Validate this proposal package, not the game runtime or its future implementation."""
from pathlib import Path
import argparse, collections, csv, hashlib, json, re, subprocess, sys
from PIL import Image

PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parents[1]
BASE = '0925487b686473e1a4d7e45fdc63449ef3a7d2ec'
parser = argparse.ArgumentParser()
parser.add_argument('--core-only', action='store_true', help='Skip PDF checks while the review book is being produced.')
parser.add_argument('--write-report', action='store_true')
args = parser.parse_args()
checks = []

def check(name, condition, detail=''):
    checks.append({'name': name, 'passed': bool(condition), 'detail': detail})

def read(rel):
    return json.loads((PACKAGE / rel).read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

required = ['README.md', 'source_audit_v2.md', 'story_bible_v2.md', 'dialogue_and_direction_v2.md',
            'story_proposal_v2.json', 'quest_proposals_v2.json', 'implementation_handoff_v2.md',
            'art_and_production_plan_v2.md', 'asset_manifest_v2.json', 'asset_manifest_v2.csv',
            'art_generation_manifest.json', 'references/reference_manifest.json']
check('All core deliverables exist', all((PACKAGE / x).is_file() for x in required), str(len(required)))
json_files = list(PACKAGE.rglob('*.json'))
parse_errors=[]
for path in json_files:
    try: json.loads(path.read_text(encoding='utf-8'))
    except Exception as ex: parse_errors.append(f'{path.name}: {ex}')
check('All delivered JSON parses', not parse_errors, '; '.join(parse_errors) or str(len(json_files)))
s=read('story_proposal_v2.json');q=read('quest_proposals_v2.json');a=read('asset_manifest_v2.json');g=read('art_generation_manifest.json')
runtime=json.loads((REPO/'public/data/story.json').read_text())
old=json.loads((REPO/'docs/source/chatgpt-quest-design-20261125/story_quest_map_v1.json').read_text())['storyQuests']
legacy=q['existingMainQuestMap']; new=q['additionalQuestProposals'];all_quests={x['questId']:x for x in legacy}
check('Proposal schemas cannot be confused with runtime data', all(x.get('status')=='proposal-not-runtime' for x in [s,q,a]) and not s['runtimeReplacement'])
check('Base story and legacy chapter/scene IDs are preserved', s['baseStoryId']==runtime['id'] and set(s['preserve']['chapterIds'])==set(x['id'] for x in runtime['chapters']) and set(s['preserve']['sceneIds'])==set(x['id'] for x in runtime['scenes']))
check('11 chapters; new finale before original epilogue', len(s['chapterOrder'])==11 and s['chapterOrder']==[f'ch{i}' for i in range(9)]+['proposal.chapter.thunder_return','ch9'])
fields={'questId':'questId','actorId':'speciesId','stars':'stars','timeLimitMinutes':'timeLimitMinutes','requiresAllQuestClears':'prerequisites'}
check('14 legacy quests preserve IDs, actors, stars, time and prerequisite arrays', len(legacy)==len(old)==14 and all(all(x[k]==y[v] for k,v in fields.items()) for x,y in zip(legacy,old)))
check('First two quests remain unordered', all(not x['requiresAllQuestClears'] for x in legacy[:2]))
check('ST14 remains セオルミド under monster.segranio', legacy[-1]['questId']=='quest.story.st14' and legacy[-1]['actorId']=='monster.segranio')
check('Seven new proposals, one mandatory hunt, six optional', len(new)==7 and sum(x['mandatory'] for x in new)==1 and q['plannedMandatoryHuntCount']==15 and s['counts']['newOptionalQuests']==6)
for key in ['id','code','suggestedRuntimeId']:
    check('Unique new '+key, len(set(x[key] for x in new))==len(new))
all_ids=set(all_quests)|set(x['suggestedRuntimeId'] for x in new)
bycode={x['code']:x for x in new}
final=bycode['TQ04']
check('Finale quest identity matches all handoff data', final['id']=='proposal.quest.thunder_return' and final['suggestedRuntimeId']=='quest.story.thunder_return' and s['progressionContract']['newMainQuestSuggestedRuntimeId']==final['suggestedRuntimeId'])
check('Finale requires ST14 and no optional work', final['dependencies']['requiresAllQuestClears']==['quest.story.st14'])
check('No optional proposal is lost from chapter references', set(x['id'] for x in new if not x['mandatory'])=={i for c in s['chapters'] for i in c.get('optionalQuestProposalIds',[])})
edges={x['questId']:x['requiresAllQuestClears'] for x in legacy}
edges.update({x['suggestedRuntimeId']:x['dependencies']['requiresAllQuestClears'] for x in new})
unknown={d for deps in edges.values() for d in deps if d not in all_ids}
check('Quest dependency references resolve within the design catalog', not unknown, str(sorted(unknown)))
visiting=set();done=set();cycles=[]
def visit(node):
    if node in visiting: cycles.append(node);return
    if node in done:return
    visiting.add(node)
    for dep in edges.get(node,[]):visit(dep)
    visiting.remove(node);done.add(node)
for node in edges: visit(node)
check('Quest dependency graph has no cycles', not cycles, str(cycles))
time_errors=[]
for x in new:
    t=x['time']
    if t['mode']=='field' and t['proposedFieldTimeLimitTicks']!=t['timeLimitMinutes']*60*t['tickRate']:time_errors.append(x['code'])
    if t['mode']=='hub-transaction' and any(t[k] is not None for k in ['timeLimitMinutes','proposedFieldTimeLimitTicks','tickRate']):time_errors.append(x['code'])
check('All field times and untimed hub delivery are coherent', not time_errors, str(time_errors))
check('Finale is 45 minutes / 162000 ticks', final['time']['timeLimitMinutes']==45 and final['time']['proposedFieldTimeLimitTicks']==162000)
check('Highland and species rank contract preserved', all(bycode[c]['fieldProposal']['existingCatalogFieldName']=='鉛雲高地' for c in ['TQ04','TQ05','TQ06','TQ07']) and final['actor']['speciesRankFromMonsterProposal']=='rank.2' and final['actor']['combatRankForThisQuestProposal']=='rank.4')
check('Finale outcome is not gated on watching dialogue', len(final['objective']['success'])==2 and not s['progressionContract']['dialogueReadRequired'])
check('Finale is once; repeat hunt has a different quest ID', final['replayReset']['repeatable'] is False and bycode['TQ06']['replayReset']['repeatable'] is True)
sc=s['sceneContracts'];script=(PACKAGE/'dialogue_and_direction_v2.md').read_text()
script_ids=re.findall(r'^ID：`(proposal\.scene\.thunder\.\d+)`',script,re.M)
check('Exactly 12 unique scenes match the written script', len(sc)==len(script_ids)==len(set(script_ids))==12 and set(x['id'] for x in sc)==set(script_ids))
check('Scene gates use known quests and no read-to-progress flag', all(not x['readToProgress'] and set(x['requiresAllQuestClears'])<=all_ids for x in sc))
check('Epilogue has only the final success gate', sc[-1]['requiresAllQuestClears']==['quest.story.thunder_return'] and s['chapters'][-1]['requiresAllQuestClears']==['quest.story.thunder_return'])
speakers=re.findall(r'^\| (minagi|rokuha|isane|senaki) \|',script,re.M)
check('Script retains four existing speaker keys', set(speakers)==set(runtime['speakers']), str(collections.Counter(speakers)))
check('Scene art production references exist', {x['suggestedProductionAssetId'] for x in sc}<={x['id'] for x in a['assets']})
image_errors=[]
for x in g['images']:
    path=PACKAGE/x['file']
    if not path.is_file():image_errors.append(x['file']+' missing');continue
    with Image.open(path) as im:
        if im.format!='PNG' or list(im.size)!=[x['width'],x['height']] or im.mode!=x['mode']:image_errors.append(x['file']+' metadata')
        im.verify()
    if sha(path)!=x['sha256']:image_errors.append(x['file']+' hash')
check('Four generated PNG files open and match metadata/SHA256', len(g['images'])==4 and not image_errors, str(image_errors))
asset_errors=[]
for x in a['assets']:
    path=x['path']
    if path:
        f=PACKAGE/path if path.startswith(('art/','references/')) else REPO/path
        if not f.is_file():asset_errors.append(x['id']+' missing')
        elif x.get('sha256')!=sha(f):asset_errors.append(x['id']+' stale hash')
    elif x['status']!='planned-not-produced':asset_errors.append(x['id']+' unexpected null path')
counts=dict(collections.Counter(x['status'] for x in a['assets']))
check('All 44 assets distinguish produced, existing, parallel and planned', len(a['assets'])==44 and counts==a['inventoryCounts'] and not asset_errors, str(asset_errors))
with (PACKAGE/'asset_manifest_v2.csv').open(encoding='utf-8-sig',newline='') as f:csvrows=list(csv.reader(f))
check('CSV inventory matches JSON', len(csvrows)==45 and [x[0] for x in csvrows[1:]]==[x['id'] for x in a['assets']])
refs=read('references/reference_manifest.json')['references']
check('Parallel design reference snapshots match recorded SHA256', all(sha(PACKAGE/x['localSnapshot'])==x['sha256'] for x in refs))
public_items=set()
def collect_ids(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('id'),str):public_items.add(obj['id'])
        for v in obj.values():collect_ids(v)
    elif isinstance(obj,list):
        for v in obj:collect_ids(v)
for path in (REPO/'public/data').rglob('*.json'):collect_ids(json.loads(path.read_text()))
used_items=[]
def collect_existing_items(obj):
    if isinstance(obj,dict):
        if 'existingItemId' in obj:used_items.append(obj['existingItemId'])
        for v in obj.values():collect_existing_items(v)
    elif isinstance(obj,list):
        for v in obj:collect_existing_items(v)
collect_existing_items(new)
check('Supply references marked existing resolve in current public data', set(used_items)<=public_items, str(sorted(set(used_items)-public_items)))
check('Every file is under 40 MiB', all(f.stat().st_size<40*1024*1024 for f in PACKAGE.rglob('*') if f.is_file()))
tracked=subprocess.check_output(['git','diff','--name-only',BASE],cwd=REPO,text=True).splitlines()
rel=PACKAGE.relative_to(REPO).as_posix()+'/'
check('Tracked changes are restricted to this inbox package', all(x.startswith(rel) for x in tracked), str(len(tracked))+' tracked changes; package additions may be unstaged')
whitespace=subprocess.run(['git','diff','--check'],cwd=REPO,text=True,capture_output=True)
staged_whitespace=subprocess.run(['git','diff','--cached','--check'],cwd=REPO,text=True,capture_output=True)
check('Git working and staged whitespace check', whitespace.returncode==0 and staged_whitespace.returncode==0,(whitespace.stdout+staged_whitespace.stdout).strip())
if not args.core_only:
    from pypdf import PdfReader
    pdf=PACKAGE/'Kari_Flagship_Story_Design_v2.pdf'
    check('PDF and editable review HTML exist',pdf.is_file() and (PACKAGE/'review_book.html').is_file())
    if pdf.is_file():
        reader=PdfReader(pdf);txt='\n'.join(page.extract_text() or '' for page in reader.pages)
        check('Review PDF has substantive Japanese text and pages', len(reader.pages)>=15 and all(w in txt for w in ['オルゼリオン','鉛雲高地','ミナギ']), f'{len(reader.pages)} pages / {len(txt)} extracted characters')
        check('Review PDF has no blank extracted pages', all(len((page.extract_text() or '').strip())>25 for page in reader.pages))
report={'scope':'Artifact integrity and source-contract checks only; not runtime/gameplay verification.','baseCommit':BASE,'dateJST':'2026-11-26','coreOnly':args.core_only,'passed':all(x['passed'] for x in checks),'checks':checks,'counts':{'chapters':len(s['chapterOrder']),'legacyMainQuests':len(legacy),'newQuestProposals':len(new),'newMandatoryHunts':sum(x['mandatory'] for x in new),'scriptScenes':len(sc),'generatedImages':len(g['images']),'assetRows':len(a['assets'])},'notTested':['Future game implementation','Combat, capture, animations, weather, field geometry, balance','New save migration and scene gates in runtime','iPhone rendering and performance']}
if args.write_report:(PACKAGE/'validation_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for x in checks:print(('PASS' if x['passed'] else 'FAIL')+' '+x['name']+(' — '+x['detail'] if x['detail'] else ''))
print(f"{sum(x['passed'] for x in checks)}/{len(checks)} passed")
sys.exit(0 if report['passed'] else 1)
