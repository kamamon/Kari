#!/usr/bin/env python3
"""Create reviewed replacement payloads and a patch; never edit runtime files.

Run from this repository: python chatgpt-inbox/motion-combat-20261125/implementation/balance/build_balance.py
The source snapshot is pinned. The generated patch is applied only in a separate review checkout.
"""
from pathlib import Path
import csv, difflib, hashlib, json, re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = HERE / 'replacement'
ANALYSIS = HERE.parent.parent / 'analysis'
BASE = '1d8e084d0d16fe77c376570f9542dd3c54fb5332'

# Coefficients are this project's original tuning proposals, not measurements.
# Per-hit arrays follow existing hitWindow order; bow arrays follow charge level.
PLAN = {
 'heavy_blade': {
  'overhead': ('縦斬り・溜め斬り', [1.05], '狭い縦軌道と回避不能時間を一撃へ還元。最大溜めは待ち時間込みでも無溜めより報われる。'),
  'side_sweep': ('横薙ぎ', [.70], '広い横方向の当てやすさを優先する始動。縦斬りへのつなぎに使う。'),
  'draw_slash': ('抜刀斬り', [1.00], '納刀からの長い準備と最初の一撃の位置取りを評価。'),
 },
 'guard_blade': {
  'slash1': ('斬り', [.24], '盾と速い回避移行を持つ安全な始動。'),
  'slash2': ('返し斬り', [.30], '始動より少し高い中継。'),
  'thrust': ('主連携3段目・突き', [.56], '3段目まで残る判断と横に狭い突きを評価。'),
  'bash': ('盾打ち', [.28], '短い間合い。現状は気絶効果が無いので架空の気絶価値で減額しない。'),
  'lunge': ('踏み込み抜刀斬り', [.48], '22tickの始動と1.2mの位置取りを評価。'),
 },
 'war_maul': {
  'smash': ('叩きつけ', [.60], 'コンボ始動。後続の横殴りへ威力を移す。'),
  'swing': ('横殴り（連携後半）', [.76], '叩きつけ・溜め叩き等からの派生と長い後隙を評価。再び叩きつけへ戻れる循環連携で、真の終端ではない。'),
  'charge': ('溜め叩き', [.72], '短い頭部の判定・盾無し・長い溜めを大きい一撃へ還元。気絶は未実装。'),
  'draw_smash': ('抜刀叩き', [.76], '36tickの始動と抜刀の拘束に見合う一撃。'),
 },
 'twin_blades': {
  'slash1': ('右斬り', [.18], '素早く勢いを作る始動。'),
  'slash2': ('左斬り', [.22], '始動より高い中継。'),
  'cross': ('主連携3段目・交差斬り', [.30,.30], '左右両方を当てて初めて合計0.60。短い間合いと連携継続を評価。'),
  'stab': ('二段突き', [.20,.30], '2撃目の遅い狭い判定へ威力を寄せる。'),
  'flurry': ('連ね斬り', [.16,.18,.20,.42,.42], '最後の交差2撃に合計威力の60.9%を配分。勢い消費と中断の危険を評価。'),
  'draw_cross': ('抜刀交差斬り', [.27,.27], '両腰から抜く30tickの準備を評価。片刃だけなら半分。'),
 },
 'long_blade': {
  'kesa': ('袈裟斬り', [.38], '踏み込みのある扱いやすい始動。'),
  'rise': ('斬り上げ', [.44], '中継に少し報酬を付ける。'),
  'thrust': ('主連携3段目・突き', [.72], '狭い突きと3段目到達を評価。'),
  'back_cut': ('下がり斬り', [.32], '2m離脱の安全性を持つため攻撃専用技より低い威力。無敵は追加しない。'),
  'helm': ('兜割り', [1.42], '30tickの始動・狭い縦斬り・54tickまで回避できない拘束を評価。'),
  'draw_cut': ('抜刀斬り', [.56], '30tickの抜刀準備を評価。'),
 },
 'long_lance': {
  'thrust1': ('一段突き', [.36], '長い間合い・盾への復帰を考慮した始動。'),
  'thrust2': ('二段突き', [.42], '中継。三段目へ価値を寄せる。'),
  'thrust3': ('主連携3段目・三段突き', [.72], '攻撃派生が無く、回復を最後まで払う3段目。始動→上段だけの反復より連携完遂が報われる。'),
  'high': ('上段突き', [.38], '高所の部位を狙う用途。始動と交互に使う最短ループの過大火力を抑える。'),
  'guard_thrust': ('構え突き', [.30], '全44tickで防御可能なので安全性に代価を置く。'),
  'counter_thrust': ('受け返し突き', [1.55], '敵の防御可能な攻撃を正面で受ける条件とスタミナ15を評価。独立した連打技として数えない。'),
  'lunge': ('踏み込み抜刀突き', [.82], '34tickの準備・長い直進の拘束を評価。'),
 },
 'ring_bow': {
  'shot': ('射撃・溜め射撃', [.22,.58,1.12,1.85], '待ち時間とスタミナ消費込みで溜め段階に価値を持たせる。1発の係数。'),
  'spread': ('散らし撃ち', [.17], '1本0.17、3本全部命中で0.51。近距離0.6倍と拡散で位置取りを分ける。'),
 },
}
CHARGE = {'heavy_blade.overhead': [1,1.5,2.1,2.8], 'war_maul.charge': [1,1.7,2.55,3.8]}
PHASE_END = {'ring_bow.shot': 19, 'ring_bow.spread': 17, 'twin_blades.stab': 21}

replacements = {}
def put(path, text):
 p = OUT/path
 p.parent.mkdir(parents=True, exist_ok=True)
 p.write_text(text)
 replacements[path] = text

def replace_once(text, old, new, path):
 if text.count(old) != 1: raise ValueError(f'{path}: exact match count {text.count(old)}: {old}')
 return text.replace(old,new)

families=json.loads((ROOT/'public/data/weapons.json').read_text())
fam={f['id']: f for f in families['families']}
attacks={w['family']:w['attack'] for w in families['weapons'] if w.get('starter')}
curves={c['id']:c for c in json.loads((ROOT/'public/data/curves.json').read_text())['curves']}
rows=[]
for family, plan in PLAN.items():
 path=f'public/data/actions/{family}.json'
 before=(ROOT/path).read_text()
 data=json.loads(before)
 original={a['actionId']:json.loads(json.dumps(a)) for a in data['actions']}
 for a in data['actions']:
  short=a['actionId'].split('.')[-1]
  if short not in plan: continue
  name, values, why=plan[short]
  old=original[a['actionId']]
  key=f'{family}.{short}'
  if family=='ring_bow': a['shoot'][0]['coefficient']=values
  else:
   assert len(values)==len(a['hitWindows'])
   for h,value in zip(a['hitWindows'],values):h['damageCoefficient']=value
  if key in CHARGE:a['charge']['coefficientScale']=CHARGE[key]
  if key in PHASE_END:
   for phase in a['phases']:
    if phase['id']=='active':phase['to']=PHASE_END[key]
    if phase['id']=='recovery':phase['from']=PHASE_END[key]
   # The generated trail follows the enclosing active phase. The actual 2nd hit already ends at 21.
   if key=='twin_blades.stab':
    for ev in a['events']:
     if ev['type']=='trail_off':ev['tick']=21
  root=a.get('rootMotion',{}).get('curveId')
  root_distance=curves[root]['keys'][-1][1]-curves[root]['keys'][0][1] if root else 0
  rows.append({
   'family':family,'familyName':fam[family]['name'],'actionId':a['actionId'],'name':name,
   'starterAttack':attacks[family], 'durationTicks':a['durationTicks'],
   'hitWindows':[{'id':h['id'],'from':h['from'],'to':h['to'],'damageType':h['damageType'],'maxHitsPerTarget':h['maxHitsPerTarget'],'oldCoefficient':o['damageCoefficient'],'newCoefficient':h['damageCoefficient'],'hitstopTicks':h['hitstopTicks'],'shapeTrack':h['shapeTrack']} for h,o in zip(a['hitWindows'],old['hitWindows'])],
   'shoot':a.get('shoot',[]),'oldShoot':old.get('shoot',[]),
   'charge':a.get('charge'),'oldCharge':old.get('charge'),
   'momentum':a.get('momentum'), 'cancelWindows':a['cancelWindows'],
   'firstImpactTick':min([h['from'] for h in a['hitWindows']]+[s['tick'] for s in a.get('shoot',[])]),
   'rootDistanceMeters':root_distance, 'turning':a.get('turning'),
   'bladeLengthMeters':round(fam[family]['blade']['to']-fam[family]['blade']['from'],4),
   'bladeRadiusMeters':fam[family]['blade']['radius'],
   'directEntry':any(v==a['actionId'] for k,v in fam[family]['actions'].items() if k not in ['draw','sheathe']),
   'entryNames':[k for k,v in fam[family]['actions'].items() if v==a['actionId']],
   'phaseMetadataCorrected':key in PHASE_END,
   'rationale':why,
  })
 if family=='heavy_blade':
  txt=before
  for old,new in [('"damageCoefficient":1.0','"damageCoefficient":1.05'),('"damageCoefficient":0.75','"damageCoefficient":0.7'),('"damageCoefficient":0.9','"damageCoefficient":1.0'),('"coefficientScale": [1.0, 1.3, 1.65, 2.1]','"coefficientScale": [1.0, 1.5, 2.1, 2.8]')]:
   txt=replace_once(txt,old,new,path)
  assert json.loads(txt)==data
 else:
  # Reproduce gen-weapons.mjs output formatting.
  line=lambda o:re.sub(r'"(\w+)":',r'"\1": ',json.dumps(o,ensure_ascii=False,separators=(',',':'))).replace(',"',', "')
  txt='{\n  "schemaVersion": 1,\n  "note": "tools/gen-weapons.mjs の出力。手で編集しない。数値は机上の初期値。",\n  "actions": [\n'+',\n'.join('    '+line(a) for a in data['actions'])+'\n  ]\n}\n'
 put(path,txt)

GEN_EDITS={
 'guard_blade': [("cut('gb_slash1', 0.28)","cut('gb_slash1', 0.24)"),("cut('gb_thrust', 0.42,","cut('gb_thrust', 0.56,"),("coef: 0.25, type: 'blunt'","coef: 0.28, type: 'blunt'"),("cut('gb_lunge', 0.45,","cut('gb_lunge', 0.48,")],
 'war_maul': [("hit('wm_smash', 0.62)","hit('wm_smash', 0.6)"),("hit('wm_swing', 0.58)","hit('wm_swing', 0.76)"),("hit('wm_charge', 0.6,","hit('wm_charge', 0.72,"),("coefficientScale: [1, 1.35, 1.75, 2.3]","coefficientScale: [1, 1.7, 2.55, 3.8]"),("hit('wm_draw_smash', 0.6)","hit('wm_draw_smash', 0.76)")],
 'twin_blades': [("R('tb_slash1', 0.2)","R('tb_slash1', 0.18)"),("L('tb_slash2', 0.2)","L('tb_slash2', 0.22)"),("R('tb_cross', 0.22,","R('tb_cross', 0.3,"),("L('tb_cross', 0.22,","L('tb_cross', 0.3,"),("L('tb_stab', 0.24,","L('tb_stab', 0.3,"),("active: [10, 20], track: 'tb_stab'","active: [10, 21], track: 'tb_stab'"),("R('tb_flurry', 0.2, { id: 'r1'","R('tb_flurry', 0.16, { id: 'r1'"),("L('tb_flurry', 0.2, { id: 'l1'","L('tb_flurry', 0.18, { id: 'l1'"),("R('tb_flurry', 0.3, { id: 'r3'","R('tb_flurry', 0.42, { id: 'r3'"),("L('tb_flurry', 0.3, { id: 'l3'","L('tb_flurry', 0.42, { id: 'l3'"),("R('tb_draw_cross', 0.22)","R('tb_draw_cross', 0.27)"),("L('tb_draw_cross', 0.22)","L('tb_draw_cross', 0.27)")],
 'long_blade': [("cut('lb_kesa', 0.4)","cut('lb_kesa', 0.38)"),("cut('lb_rise', 0.38)","cut('lb_rise', 0.44)"),("cut('lb_thrust', 0.5,","cut('lb_thrust', 0.72,"),("cut('lb_back', 0.42)","cut('lb_back', 0.32)"),("cut('lb_helm', 1.15,","cut('lb_helm', 1.42,"),("cut('lb_draw_cut', 0.48)","cut('lb_draw_cut', 0.56)")],
 'long_lance': [("chain('thrust1', 0.5,","chain('thrust1', 0.36,"),("chain('thrust2', 0.5,","chain('thrust2', 0.42,"),("chain('thrust3', 0.62,","chain('thrust3', 0.72,"),("stab('ll_high', 0.55)","stab('ll_high', 0.38)"),("stab('ll_guard_thrust', 0.36,","stab('ll_guard_thrust', 0.3,"),("stab('ll_counter_thrust', 1.6,","stab('ll_counter_thrust', 1.55,"),("stab('ll_lunge', 0.7,","stab('ll_lunge', 0.82,")],
 'ring_bow': [("active: [14, 18]","active: [14, 19]"),("coefficient: [0.18, 0.3, 0.55, 0.9]","coefficient: [0.22, 0.58, 1.12, 1.85]"),("active: [12, 16]","active: [12, 17]"),("coefficient: [0.22]","coefficient: [0.17]")],
}
for family,edits in GEN_EDITS.items():
 path=f'tools/weapons/{family}.mjs'
 txt=(ROOT/path).read_text()
 for old,new in edits:txt=replace_once(txt,old,new,path)
 put(path,txt)

ANALYSIS.mkdir(parents=True,exist_ok=True)
report={'schemaVersion':1,'baseCommit':BASE,'status':'proposal; no live playtest','motionValueConvention':'MV = damageCoefficient × 100; per-hit values are rounded independently by the runtime after all multipliers','counts':{'families':7,'damagingActions':len(rows),'meleeActions':sum(bool(r['hitWindows']) for r in rows),'projectileActions':sum(bool(r['shoot']) for r in rows),'meleeHitWindows':sum(len(r['hitWindows']) for r in rows)},'rows':rows}
(ANALYSIS/'balance-motion-values.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

csvrows=[]
for r in rows:
 levels=range(len(r['charge']['coefficientScale'])) if r['charge'] else [0]
 for level in levels:
  mul=r['charge']['coefficientScale'][level] if r['charge'] else 1
  oldmul=r['oldCharge']['coefficientScale'][level] if r['oldCharge'] else 1
  old=[h['oldCoefficient']*oldmul for h in r['hitWindows']]
  new=[h['newCoefficient']*mul for h in r['hitWindows']]
  if r['shoot']:
   sh=r['shoot'][0]; oldsh=r['oldShoot'][0]
   old=[oldsh['coefficient'][min(level,len(oldsh['coefficient'])-1)]]*sh['count']
   new=[sh['coefficient'][min(level,len(sh['coefficient'])-1)]]*sh['count']
  hold=r['charge']['levelTicks'][level-1] if r['charge'] and level else 0
  csvrows.append({'weapon':r['familyName'],'action':r['name'],'actionId':r['actionId'],'chargeLevel':level,'holdTicks':hold,'oldPerHitMV':' + '.join(f'{x*100:g}' for x in old),'newPerHitMV':' + '.join(f'{x*100:g}' for x in new),'oldTotalMV':round(sum(old)*100,4),'newTotalMV':round(sum(new)*100,4),'durationTicks':r['durationTicks'],'firstImpactTick':r['firstImpactTick'],'starterAttack':r['starterAttack'],'neutralDamageAtZone1':sum(int(r['starterAttack']*x+1e-9) for x in new),'rootDistanceMeters':r['rootDistanceMeters'],'rationale':r['rationale']})
with (ANALYSIS/'balance-motion-values.csv').open('w',newline='',encoding='utf-8-sig') as fp:
 w=csv.DictWriter(fp,fieldnames=list(csvrows[0]));w.writeheader();w.writerows(csvrows)

patch=[]; manifest=[]
for path,txt in replacements.items():
 original=(ROOT/path).read_text()
 patch.append(''.join(difflib.unified_diff(original.splitlines(True),txt.splitlines(True),fromfile='a/'+path,tofile='b/'+path)))
 manifest.append({'path':path,'beforeSha256':hashlib.sha256(original.encode()).hexdigest(),'afterSha256':hashlib.sha256(txt.encode()).hexdigest()})
(HERE/'balance.patch').write_text(''.join(patch))
(HERE/'manifest.json').write_text(json.dumps({'baseCommit':BASE,'files':manifest},indent=2)+'\n')
print(json.dumps({'replacementFiles':len(replacements),'counts':report['counts'],'expandedRows':len(csvrows),'output':str(HERE)},ensure_ascii=False))

# Existing assertions encode old exact balance numbers. Keep independent numeric
# assertions; do not weaken these to inequalities or compute expectations from the data.
test_edits={
 'tests/combat.test.ts':[
 ('damageCoefficient: 1.0, maxHitsPerTarget: 1, hitstopTicks: 4','damageCoefficient: 1.05, maxHitsPerTarget: 1, hitstopTicks: 4',1),
 ('// 80 × 1.0 × 1.0 × 0.70 = 56','// 80 × 1.05 × 1.0 × 0.70 = 58.8 → 58',1),
 ('expect(h.damage).toBe(56);','expect(h.damage).toBe(58);',1),
 ('toBe(1200 - 56);','toBe(1200 - 58);',1),
 ('// 80 × (1.0 × 1.65) × 0.70 = 92.4 → 92','// 80 × (1.05 × 2.1) × 0.70 = 123.48 → 123',1),
 ('expect(h.damage).toBe(92);','expect(h.damage).toBe(123);',1)],
 'tests/edge.test.ts':[
 ('attack: 80, motion: 1, sharpness: scale','attack: 80, motion: 1.05, sharpness: scale',1),
 ('係数 1.0 × 1.6 = 1.6 減る','係数 1.05 × 1.6 = 1.68 減る',1),
 ('toBeCloseTo(98.4, 6)','toBeCloseTo(98.32, 6)',3),
 ('toBeCloseTo(58.9, 6)','toBeCloseTo(58.82, 6)',1),
 ('50 - 1.6 * 2','50 - 1.68 * 2',1)]
}
test_patch=[];test_manifest=[]
for path,changes in test_edits.items():
 original=(ROOT/path).read_text();text=original
 for old,new,count in changes:
  assert text.count(old)==count,(path,old,text.count(old))
  text=text.replace(old,new)
 target=HERE/'test-replacement'/path
 target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
 test_patch.append(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile='a/'+path,tofile='b/'+path)))
 test_manifest.append({'path':path,'beforeSha256':hashlib.sha256(original.encode()).hexdigest(),'afterSha256':hashlib.sha256(text.encode()).hexdigest()})
(HERE/'test-expectations.patch').write_text(''.join(test_patch))
(HERE/'test-expectations-manifest.json').write_text(json.dumps(test_manifest,indent=2)+'\n')
