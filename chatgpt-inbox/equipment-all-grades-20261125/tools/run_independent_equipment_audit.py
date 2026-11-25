from pathlib import Path
from fractions import Fraction as F
from collections import Counter,defaultdict
from math import floor,ceil
import json,hashlib,re,subprocess

pkg=Path(__file__).resolve().parents[1]
repo=pkg.parents[1]
def rd(p):return json.loads(p.read_text())
d=rd(pkg/'data/all-equipment.json'); baseline=rd(pkg/'data/baseline-equipment.json')
source_w=rd(repo/'public/data/weapons.json')['weapons'];source_a=rd(repo/'public/data/armor.json')['armor'];source_r=rd(repo/'public/data/recipes.json')['recipes']
source_s=rd(repo/'public/data/bestiary.json')['species'];source_m=rd(repo/'public/data/items.json')['materials']+rd(repo/'public/data/items_creatures.json')['materials']
source_ranks=rd(repo/'public/data/ranks.json')['ranks'];source_resources=rd(repo/'docs/source/chatgpt-quest-design-20261125/resources_v2.json')['resources']
w=d['weaponCandidates'];a=d['armorCandidates'];r=d['recipes'];ss=d['series'];mm=d['materials'];vv=d['rankVariants']
S={x['id']:x for x in ss};MS={x['id']:x for x in source_s};M={x['id']:x for x in mm};I={x['id']:x for x in w+a};OLD={x['id']:x for x in source_w+source_a};OR={x['id']:x for x in source_r};SM={x['id']:x for x in source_m};RES={x['id']:x for x in source_resources}
families=['heavy_blade','guard_blade','war_maul','twin_blades','long_blade','long_lance','ring_bow'];slots=['head','chest','arms','waist','legs'];elements=['fire','thunder','ice','water','wind','mist'];statuses=['poison','paralysis','sleep']
rankname={x['order']:x['name'] for x in source_ranks};rank=lambda x:int(str(x).split('.')[-1])
WREF={(x['family'],int(x['id'].rsplit('.',1)[1])-1):x for x in source_w if not x.get('starter')}
ADEF={g:sum(x['defense'] for x in source_a if int(x['id'].rsplit('.',1)[1])==g+1) for g in rankname}
results=[]
def ck(name,errs,details=None):results.append(dict(name=name,passed=not errs,errorCount=len(errs),errors=errs[:25],details=details))
def roundh(v):return floor(v+F(1,2))
def frac(v):return F(str(v))
def normstatus(s):return 'paralysis' if s=='para' else s

# Species and rank domain are derived from immutable repository data, not builder assertions.
mon=[s for s in ss if s['category']=='monster'];non=[s for s in ss if s['category']!='monster']
errs=[]
if {s['sourceSpeciesId'] for s in mon}!=set(MS):errs.append('species set mismatch')
for s in mon:
 src=MS[s['sourceSpeciesId']]
 for f in ['no','name']:
  if s[f]!=src[f]:errs.append([s['id'],f])
 if s['nativeRank']!=rank(src['rank']):errs.append([s['id'],'nativeRank'])
 if s['source']!=src:errs.append([s['id'],'sourceRecord'])
 if s['sourceSpeciesId'] in ['monster.tarhegna','monster.segranio','monster.galdros'] and s['sourceSpeciesId'] not in MS:errs.append([s['id'],'persistent id'])
ck('原典86種の恒久ID・番号・名前・初登場級・参照原文',errs,{'nativeCounts':dict(Counter(rank(s['rank']) for s in source_s)),'Galdros':MS['monster.galdros']['name'],'No57':MS['monster.tarhegna']['name'],'No71':MS['monster.segranio']['name']})
expected={(s['id'],g) for s in ss for g in range(s['nativeRank'],max(rankname)+1)}
actual={(v['seriesId'],v['rank']) for v in vv};errs=[]
if expected!=actual or len(vv)!=len(actual):errs.append('rank variant keys differ')
for sid,g in expected:
 if Counter(x['family'] for x in w if (x['seriesId'],x['rank'])==(sid,g))!=Counter(families):errs.append([sid,g,'weapon family set'])
 if Counter(x['slot'] for x in a if (x['seriesId'],x['rank'])==(sid,g))!=Counter(slots):errs.append([sid,g,'armor slot set'])
ck('初登場級から極級までの直積を集合で再構成',errs,{'derivedVariants':len(expected),'monsterVariants':sum(5-rank(s['rank']) for s in source_s),'nonHuntVariants':sum(5-s['nativeRank'] for s in non),'weapons':len(w),'armor':len(a),'recipes':len(r)})
errs=[]
for label,rows in [('series',ss),('equipment',w+a),('recipes',r),('materials',mm)]:
 dup=[k for k,v in Counter(x['id'] for x in rows).items() if v>1]
 if dup:errs.append([label,dup])
if set(I)&set(M):errs.append('equipment/material namespace collision')
if {x['resultId'] for x in r}!=set(I):errs.append('recipe result set')
ck('ID一意性とレシピ結果の全件対応',errs,{'equipmentIds':len(I),'materialIds':len(M)})
errs=[]
for field,orig in [('weapons',source_w),('armor',source_a),('recipes',source_r)]:
 if baseline[field]!=orig:errs.append([field,'full baseline differs'])
oldw=[x for x in w if x['runtimeExists']];olda=[x for x in a if x['runtimeExists']];oldr=[x for x in r if x['runtimeExists']]
for x in oldw+olda:
 if x['sourceRecord']!=OLD[x['id']]:errs.append([x['id'],'source record'])
 for f in ('name','attack','defense'):
  if f in OLD[x['id']] and x[f]!=OLD[x['id']][f]:errs.append([x['id'],f])
for x in oldr:
 src=OR.get(x['id'])
 if x['sourceRecord']!=src:errs.append([x['id'],'recipe source'])
 expectedfrom=src.get('fromWeaponId') or src.get('fromArmorId');expectedto=src.get('resultWeaponId') or src.get('resultArmorId')
 if (x['fromId'],x['resultId'],x['money'])!=(expectedfrom,expectedto,src['cost']['money']):errs.append([x['id'],'lifted recipe fields'])
 if [(z['materialId'],z['count']) for z in x['ingredients']]!=[(z['itemId'],z['count']) for z in src['cost']['items']]:errs.append([x['id'],'lifted ingredients'])
if (len(oldw),len(olda),len(oldr))!=(len(source_w)-7,len(source_a)-5,len(source_r)):errs.append('existing counts')
ck('現行35武器25防具48レシピの全フィールドと既存候補の保持',errs,{'fullBaseline':[len(source_w),len(source_a),len(source_r)],'rankedExisting':[len(oldw),len(olda),len(oldr)]})

# Rational arithmetic deliberately avoids the generator decimal/float implementation.
profile={'raw':(F(1),0,F(0),F(0)),'precision':(F(94,100),25,F(0),F(0)),'single':(F(92,100),0,F(28,100),F(0)),'status':(F(94,100),0,F(0),F(1,10)),'compound':(F(88,100),0,F(28,100),F(0))}
errs=[];halves=[]
for x in w:
 s=S[x['seriesId']];A=WREF[x['family'],x['rank']]['attack'];p=x['profile'];ar,c,er,sr=profile[p]
 if s['category']!='monster':ar=frac(s['rawRatio']);c=s['affinity'];er=sr=F(0)
 elif s['sourceSpeciesClass']=='juvenile':ar*=F(94,100);er*=F(85,100);sr*=F(85,100)
 expected_attack=A if x['runtimeExists'] else roundh(A*ar)
 E=F(roundh(A*er))*(F(3,2) if p=='compound' else 1)
 sp=F(roundh(A*sr*10),10)
 if (x['attack'],frac(x['elementValue']),frac(x['statusPotency']),x['affinity'])!=(expected_attack,E,sp,c):errs.append([x['id'],[x['attack'],x['elementValue'],x['statusPotency'],x['affinity']],[expected_attack,float(E),float(sp),c]])
 if x['referenceAttack']!=A:errs.append([x['id'],'wrong referenceAttack'])
 if p=='compound' and E.denominator==2:halves.append({'id':x['id'],'A':A,'E':float(E)})
ck('全1750武器を有理数演算で独立再計算（正の四捨五入・幼体・採取係数）',errs,{'compoundHalfValues':len(halves),'examples':halves[:5]})
errs=[]
for x in w:
 p=x['profile'];es=x['elements'];st=x['status'];s=S[x['seriesId']]
 if len(es)!=len(set(es)) or any(e not in elements for e in es):errs.append([x['id'],'element domain'])
 if p=='compound' and (len(es)!=2 or x['rank']<3):errs.append([x['id'],'compound'])
 if p=='single' and len(es)!=1:errs.append([x['id'],'single'])
 if p=='status' and (st not in statuses or es):errs.append([x['id'],'status'])
 if p!='status' and st is not None:errs.append([x['id'],'unexpected status'])
 if p in ('raw','precision') and (es or x['elementValue']):errs.append([x['id'],'raw elemental'])
 if st=='stun':errs.append([x['id'],'universal stun'])
 if s['category']!='monster' and (es or st or x['elementValue'] or x['statusPotency']):errs.append([x['id'],'nonhunt attack effect'])
ck('属性と状態の排他・複合の級制限・stun全武器付与なし',errs,{'profiles':dict(Counter(x['profile'] for x in w)),'statuses':dict(Counter(str(x['status']) for x in w))})
errs=[];defexamples=[]
for v in vv:
 s=S[v['seriesId']];g=v['rank'];factor={'heavy':F(1),'medium':F(95,100),'light':F(9,10)}[s['armorClass']]
 if s['category']!='monster' or s['sourceSpeciesClass']=='juvenile':factor*=F(9,10)
 target=ADEF[g] if s.get('sourceSpeciesId')=='monster.galdros' else roundh(ADEF[g]*factor)
 q,rem=divmod(target,5);dist={sl:q+int(sl in ['chest','legs','head','arms','waist'][:rem]) for sl in slots}
 if v['setDefense']!=target or v['defenseBySlot']!=dist:errs.append([s['id'],g,'set defense'])
 for x in a:
  if (x['seriesId'],x['rank'])==(s['id'],g) and x['defense']!=dist[x['slot']]:errs.append([x['id'],'piece defense'])
 if s['id'] in ('series.galdros','series.kordopil','gathering.woven_grass'):defexamples.append({'series':s['id'],'rank':g,'total':target,'slots':dist})
ck('全1250防具を原典防御基準と有理数で再配分',errs,{'sourceSetDefense':ADEF,'examples':defexamples})
errs=[]
for x in a:
 s=S[x['seriesId']];skill=x['skill'];expectedskill=s['primarySkill'] if x['slot'] in ['head','arms','legs'] else s['secondarySkill']
 if skill['id']!=expectedskill or skill['points']!=1:errs.append([x['id'],'skill allocation'])
 p=skill['parameters']
 if skill['id']=='element_resistance' and p.get('element') not in elements:errs.append([x['id'],'typed element'])
 if skill['id']=='status_resistance' and p.get('status') not in statuses+['stun']:errs.append([x['id'],'typed status'])
 if s['category']=='monster':src=MS[s['sourceSpeciesId']];expectedres={e:3 if e in src['resist'] else -2 if e in src['weak'] else 0 for e in elements}
 else:expectedres={e:0 for e in elements}
 if x['resistances']!=expectedres:errs.append([x['id'],'resistance source'])
for s in ss:
 if s['primarySkill']==s['secondarySkill']:errs.append([s['id'],'same skill loses intended 3/2 distribution'])
ck('技能点の部位配分と型付き耐性・素材元弱点耐性を独立照合',errs,{'skillCount':len(d['rules']['skills']),'pointsPerSet':5,'typedAggregationDocumented':'(id,element)' in d['rules']['armor']['typedSkills'] and '(id,status)' in d['rules']['armor']['typedSkills']})

# Traverse upgrade graph rather than infer acyclicity from the IDs.
errs=[];parents={};children=defaultdict(list);crafts=0;upgrades=0
for z in r:
 x=I[z['resultId']];s=S[x['seriesId']];pa=z['fromId'];parents[x['id']]=pa
 if z['consumesPrevious']!=(pa is not None):errs.append([z['id'],'consumption flag'])
 if pa is None:
  crafts+=1
  if x['rank']!=s['nativeRank'] or z['kind']!='craft':errs.append([z['id'],'native craft'])
 else:
  upgrades+=1;children[pa].append(x['id']);p=I.get(pa) or OLD.get(pa)
  if p is None:errs.append([z['id'],'missing parent']);continue
  if x['id']==pa:errs.append([z['id'],'self loop'])
  axis='family' if z['itemType']=='weapon' else 'slot';stat='attack' if axis=='family' else 'defense'
  if x[axis]!=p[axis] or x[stat]<=p[stat]:errs.append([z['id'],'nonmonotonic or changed type'])
  if pa in I and (p['seriesId']!=x['seriesId'] or p['rank']!=x['rank']-1):errs.append([z['id'],'cross series/rank parent'])
for k,vals in children.items():
 if len(vals)>1:errs.append([k,'branch',vals])
state={}
def visit(k):
 if state.get(k)==1:errs.append([k,'cycle']);return
 if state.get(k)==2:return
 state[k]=1
 if parents.get(k) in parents:visit(parents[k])
 state[k]=2
for k in parents:visit(k)
ck('強化グラフをDFSで全探索し循環・横派生・飛び級・能力低下を検出',errs,{'craftRoots':crafts,'upgrades':upgrades,'nodesVisited':len(state),'maxOutgoing':max(map(len,children.values()))})

# Compare quantitative costs independently, canonically merging same material names.
errs=[];allunits=0;mergedexamples=[]
for z in r:
 x=I[z['resultId']];s=S[x['seriesId']];g=x['rank'];ings=z['ingredients']
 if len({i['materialId'] for i in ings})!=len(ings):errs.append([z['id'],'duplicate id'])
 if len({i['name'] for i in ings})!=len(ings):errs.append([z['id'],'duplicate material name'])
 if any(i['materialId'] not in M or i['name']!=M[i['materialId']]['name'] or type(i['count']) is not int or i['count']<=0 for i in ings):errs.append([z['id'],'ingredient data'])
 total=sum(i['count'] for i in ings);allunits+=total
 if z['runtimeExists']:continue
 if z['itemType']=='weapon':
  fam=x['family'];counts=[4+(g-1)+{'heavy_blade':1,'war_maul':1,'twin_blades':1,'long_lance':2}.get(fam,0),2+int(g>=3)+{'guard_blade':1,'long_lance':1,'ring_bow':2}.get(fam,0),1+int(g>=3)];money=[0,120,400,900,1800][g]
 else:
  sl=x['slot'];counts=[{'head':2,'chest':4,'arms':3,'waist':3,'legs':4}[sl]+g-1,2 if sl in ['chest','legs'] else 1,1 if sl in ['head','chest','legs'] else 0];money=[0,80,250,550,1100][g]
 factor=F(7,10) if s['category']!='monster' else F(85,100) if s['sourceSpeciesClass']=='juvenile' else F(1)
 if total!=sum(counts):errs.append([z['id'],'total units changed',total,sum(counts)])
 if z['money']!=roundh(money*factor):errs.append([z['id'],'money'])
 mids=next(v['materialRoles'] for v in vv if (v['seriesId'],v['rank'])==(s['id'],g));target=Counter()
 for mid,c in zip(mids,counts):target[mid]+=c
 target=Counter({k:v for k,v in target.items() if v})
 actual=Counter({i['materialId']:i['count'] for i in ings})
 if actual!=target:errs.append([z['id'],'canonical merged role counts',dict(actual),dict(target)])
 if len(set(mids))<3 and len(mergedexamples)<5:mergedexamples.append({'recipeId':z['id'],'roleCounts':counts,'ingredients':ings,'total':total})
ck('材料重複の統合と1点ごとの必要総量・費用を全3000件で再計算',errs,{'allRecipeMaterialUnits':allunits,'canonicalMergeExamples':mergedexamples,'originalDefect':{'duplicateRoleMaterials':103,'affectedRecipes':1030,'beforeRows':686,'afterExpectedRows':583}})
errs=[];groups=defaultdict(list)
for m in mm:
 if m.get('sourceSpeciesId'):groups[(m['sourceSpeciesId'],m.get('rankOrder'),m['name'])].append(m['id'])
 if m['isImplemented']:
  if m['id'] not in SM or m['sourceRecord']!=SM[m['id']]:errs.append([m['id'],'implemented record mismatch'])
 if m.get('sourceProposalExists'):
  if m['id'] not in RES or m['sourceRecord']!=RES[m['id']]:errs.append([m['id'],'resource source record'])
for k,ids in groups.items():
 if len(ids)>1:errs.append([k,ids])
if set(SM)-set(M):errs.append('lost implemented material')
ck('同一種・同一級・同一素材名の一意性と既存77素材の原文保持',errs,{'materialRows':len(mm),'implemented':sum(m['isImplemented'] for m in mm),'proposed':sum(not m['isImplemented'] for m in mm)})
errs=[];cargo={x['id'] for x in source_resources if not x.get('ordinaryInventoryAllowed',True)};nonrecipes=0
for z in r:
 s=S[z['seriesId']]
 if s['category']=='monster':continue
 nonrecipes+=1
 for i in z['ingredients']:
  m=M[i['materialId']]
  if m['acquisition'] not in ('gather','mining','insect') or m['id'] in cargo:errs.append([z['id'],'hunt or cargo ingredient'])
  if m['isImplemented']:errs.append([z['id'],'new harvest material falsely implemented'])
  if m['rankOrder']!=z['rank']:errs.append([z['id'],'higher/lower grade input'])
for s in non:
 if {m['rank'] for m in s['materialChain']}!={1,2,3,4}:errs.append([s['id'],'chain rank coverage'])
 if s['nativeRank']!=1:errs.append([s['id'],'native rank'])
ck('採集・採掘・虫取りだけで揃う432レシピと同級供給',errs,{'nonHuntRecipeCount':nonrecipes,'seriesByAcquisition':dict(Counter(s['category'] for s in non)),'materialByAcquisition':dict(Counter(m['acquisition'] for m in mm)),'loanedCargoIds':sorted(cargo),'toolGate':'rules.acquisition.sameGrade explicitly permits initial loaned tools'})
errs=[]
for s in mon:
 mats=set(MS[s['sourceSpeciesId']]['materials'])
 for key in ['mainMaterial','supportMaterial','organMaterial']:
  val=s[key]
  if isinstance(val,str) and val not in mats:errs.append([s['id'],key,val,'not in source material list'])
ck('モンスター素材名の原典材料リストへの所属',errs)

# Document math and runtime boundaries are checked against source implementation.
readme=(pkg/'README.md').read_text();handoff=(pkg/'CLAUDE_HANDOFF.md').read_text();rules=d['rules'];errs=[]
if d.get('runtimeImportable') is not False:errs.append('direct import flag')
for token in ['1,750','1,250','3,000','2,952','214','36','250','95']:
 if token not in readme:errs.append(['README','missing count',token])
if f'{len(mm)}行' not in handoff:errs.append(['HANDOFF','material count stale'])
if f'既存{len(source_m)}素材' not in handoff:errs.append(['HANDOFF','existing material count stale'])
for g in rankname:
 row=d['counts']['byRank'][str(g)];moncount=sum(rank(s['rank'])<=g for s in source_s);totalseries=moncount+len(non)
 if row!={'monsterSeries':moncount,'nonhuntSeries':len(non),'weapons':totalseries*7,'armor':totalseries*5}:errs.append(['counts',g])
if '片方でも弱点なら半減しない' not in rules['weapons']['compound']:errs.append('compound weak truth condition ambiguity')
if floor(F('72.864')*F('0.7'))!=51 or floor(floor(F('72.864'))*F('0.7'))!=50:errs.append('rounding example')
if (F('0.92')*F('0.60')+F('0.28')*F('0.30'))/F('0.60')!=F('1.06'):errs.append('single example')
if (F('0.88')*F('0.60')+F('0.42')*F('0.30'))/F('0.60')!=F('1.09'):errs.append('compound example')
ck('文書件数・丸め例・机上比較・複合弱点の真理条件',errs,{'byRank':d['counts']['byRank'],'singleRawRatio':1.06,'compoundWeakRatio':1.09,'guardBreakExample':51,'materialRowsInHandoff':len(mm)})
errs=[]
sourcechecks={
 'src/game/combat.ts':['d.attack * d.motion * d.sharpness * d.hitzone * d.crit','d.element * d.elementMotion * d.elementZone','Math.max(1, Math.floor'],
 'src/game/player.ts':['Math.floor(hit.baseDamage * G.chipScale)','Math.floor(hit.baseDamage * G.breakDamageScale)','Math.floor(hit.baseDamage)'],
 'src/save/profile.ts':['SAVE_SCHEMA_VERSION = 4'],
 'src/game/sim.ts':['h.baseDamage * this.monsterAttackScale * this.defenseScale','(m.enraged && m.def.rage ? m.def.rage.damageScale : 1)'],
 'src/data/validators.ts':['sources.has(fromId)','to.attack > from.attack','to.defense > from.defense'],
}
for file,tokens in sourcechecks.items():
 text=(repo/file).read_text()
 for t in tokens:
  if t not in text:errs.append([file,t])
if rd(repo/'public/data/armor.json')['defense']['base']!=100:errs.append('defense base')
if rd(repo/'public/data/player.json')['critMultiplier']!=1.25:errs.append('crit multiplier')
q=rd(repo/'public/data/quests.json')['quests']
if [x['id'] for x in q]!=['quest.basin.003','quest.basin.r2.001','quest.basin.r3.001','quest.basin.r4.001']:errs.append('quest chain ids')
if any(q[i].get('requires')!=[q[i-1]['id']] for i in range(1,4)):errs.append('quest chain requires')
ck('防御・会心・受傷floor・hazard/rage・保存schema4・進行の現行コード照合',errs,{'newSkillsStatusAndHarvest':'proposal only; no runtime playtest claimed'})
errs=[]
for s in ss:
 expectedgrades={str(g) for g in range(s['nativeRank'],5)}
 if set(s['gradeAppearance'])!=expectedgrades:errs.append([s['id'],'appearance grades'])
 for fam in families:
  if set(s['weapons'][fam]['gradeEvolution'])!=expectedgrades:errs.append([s['id'],fam,'evolution grades'])
ck('系列外観・全武器の級別形状仕様の欠落なし',errs,{'artExcluded':'Artwork is validated in separate records; no 250-image claim'})

# Numeric fingerprint ignores art metadata so final image merge can be independently distinguished.
num={k:d[k] for k in ['counts','rankVariants','weaponCandidates','armorCandidates','recipes','materials','rules']}
def stripart(x):
 if isinstance(x,list):return [stripart(v) for v in x]
 if isinstance(x,dict):return {k:stripart(v) for k,v in x.items() if k not in ['artFile','artRank','appearanceArt']}
 return x
numeric_hash=hashlib.sha256(json.dumps(stripart(num),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
report={'auditType':'independent static source and rational-math audit','date':'2026-11-25','sourceCommit':d['sourceCommit'],'repositoryHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'auditedAllEquipmentSha256':hashlib.sha256((pkg/'data/all-equipment.json').read_bytes()).hexdigest(),'numericFingerprintWithoutArt':numeric_hash,'method':'No generator import/execution. Repository source equality, independent rational arithmetic, graph DFS, canonical material reconciliation, documentation calculations. Review performed after root fixed the two early findings.','initialFindings':[{'severity':'major','issue':'One material split into role-dependent IDs','duplicateRows':103,'affectedRecipes':1030,'resolution':'Root introduced species/rank/name cache; rechecked all 3000 recipe totals and 583 unique material rows.'},{'severity':'wording','issue':'Compound weak condition could be read as requiring both attributes weak','resolution':'Root explicitly says half damage only when neither is weak; any one weakness prevents halving.'}],'passed':all(x['passed'] for x in results),'checks':results,'limits':['Static design consistency only; no game implementation, playtest, economy simulation or iPhone validation.','Direct-craft UI, drop tables, high-grade spawns, new fields, materials, skills and statuses require implementation.','Final artwork merge can change the full data hash without changing the independent numeric fingerprint.','Back views, orthographic drawing and every-grade image generation are not part of this numerical audit.']}
out=pkg/'analysis';out.mkdir(exist_ok=True);(out/'independent-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# 独立監査 — 全装備四級版','',f"対象: `{d['sourceCommit']}` / 2026-11-25",'',f"結果: {'全項目適合' if report['passed'] else '要修正あり'}。独立確認 {len(results)} 項目。",'', '## 先に見つけ、修正後に再照合した点','','1. 同一種・同一級・同一名の素材が役割別IDへ分かれていた。103重複素材行、1,030レシピに影響。主担当がID再利用へ修正した後、素材583行と全3,000レシピの必要総量・費用を別実装で再計算した。','2. 複合属性の半減条件を「二属性のどちらも相手の弱点でない時だけ」へ統一した。片方でも弱点なら半減しない。','', '## 照合方法','','生成ビルダーはimportも実行もしていない。原典JSONと全文比較し、武器と防具はFractionの有理数で再計算した。強化の循環・横派生・飛び級は全ノードのDFSで確認し、素材重複の修正前と同じ総量になることを全レシピの独立した数量式で確かめた。','', '| 確認 | 結果 |','|---|---|']
for x in results:lines.append(f"| {x['name']} | {'適合' if x['passed'] else '要修正 '+str(x['errorCount'])+'件'} |")
lines+=['','## 具体的な結果','',f"95系列・250系列級・1,750武器・1,250防具・3,000レシピ。既存35武器・25防具・48レシピの比較用コピー、候補内の既存28武器・20防具・48レシピを原典と照合した。素材は{len(mm)}行で既存77行、新規候補{len(mm)-77}行。非狩猟9系列432レシピは採集・採掘・虫素材だけを使う。",'',f"複合Eの0.5を保持する実例は{len(halves)}件。受傷72.864×0.7は51、前段で切り捨てる誤実装なら50。仮定肉質による単属性1.06倍・複合1.09倍の文書例も成立する。",'', '## 未検証の範囲','','実行時の技能・状態異常・採取点・直接生産・保存拡張は未実装。ドロップ実測、実戦DPS、採取経済、iPhone操作はこの監査に含めない。原画の確認記録は別管理であり、最終アート統合は完全データのハッシュを変える可能性がある。','','## 監査対象の指紋','',f"完全データ SHA256: `{report['auditedAllEquipmentSha256']}`",'',f"アート参照を除いた数値内容 SHA256: `{numeric_hash}`",'']
for x in results:
 if not x['passed']:lines+=['## 要修正: '+x['name'],'','```json',json.dumps(x['errors'],ensure_ascii=False,indent=2),'```','']
(out/'independent-audit.md').write_text('\n'.join(lines))
print(json.dumps({'passed':report['passed'],'checks':len(results),'failures':[{k:x[k] for k in ('name','errorCount','errors')} for x in results if not x['passed']],'materialRows':len(mm),'nonHuntRecipes':nonrecipes,'numericFingerprint':numeric_hash},ensure_ascii=False,indent=2))
