// Reproducible timing study, NOT a player-skill or collision playtest.
// Uses the actual stepPlayer/createPlayer/newRun/computeDamage implementations.
// Test target: every hit window connects at its first active tick; all arrows connect,
// sharpness/hitzone/quest/crit = 1; edge wear, enemy AI, incoming hits, movement obstruction
// and arrow flight time are deliberately excluded. Real hitstop, legal cancels, charge,
// momentum speed and stamina recovery remain active.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';

const HERE=dirname(fileURLToPath(import.meta.url));
const ROOT=resolve(HERE,'../../../..');
const REPORT=resolve(HERE,'../../analysis');
const sourceManifest=JSON.parse(await readFile(resolve(HERE,'manifest.json'),'utf8'));
for(const file of sourceManifest.files){
 const bytes=await readFile(resolve(ROOT,file.path));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),file.beforeSha256,
  `Baseline changed: ${file.path}. Run this comparison in the original baseline checkout with the inbox payload present, before applying the patch.`);
}
const server=await createServer({root:ROOT,configFile:false,server:{middlewareMode:true},logLevel:'error'});
const {assembleContent}=await server.ssrLoadModule('/src/data/validators.ts');
const {createPlayer,startAction,stepPlayer}=await server.ssrLoadModule('/src/game/player.ts');
const {computeDamage}=await server.ssrLoadModule('/src/game/combat.ts');
const {trackSegment,sampleCurve}=await server.ssrLoadModule('/src/game/tracks.ts');
const {SeededRng}=await server.ssrLoadModule('/src/core/seededRng.ts');
const {Btn}=await server.ssrLoadModule('/src/game/inputFrame.ts');
const manifest=JSON.parse(await readFile(resolve(REPORT,'balance-motion-values.json'),'utf8'));
const familyIds=[...new Set(manifest.rows.map(r=>r.family))];
async function load(proposed) {
 return assembleContent(async p=> {
  const override=proposed && familyIds.some(f=>p===`actions/${f}.json`);
  return JSON.parse(await readFile(resolve(override?resolve(HERE,'replacement/public/data'):resolve(ROOT,'public/data'),p),'utf8'));
 });
}
const contents={current:await load(false),proposed:await load(true)};
const dataDamage=(attack,motion)=>computeDamage({attack,motion,sharpness:1,hitzone:1,crit:1,element:0,elementMotion:0,elementZone:0,questModifier:1});

function harness(content,family,momentum=0){
 const fam=content.families.get(family);
 const weapon=[...content.weapons.values()].find(w=>w.family===family&&w.starter);
 const p=createPlayer(content,{x:0,z:0,yaw:0},weapon.id);
 p.drawn=true;p.momentum=momentum;
 const hits=new Set();
 const out={damage:0,hits:0,starts:[],staminaMin:100,chargeLevels:{},hitLog:[],nominalEdgeSpent:0};
 let id=0;
 const ctx={content,field:null,rng:new SeededRng(12345),tick:0,
  world:{move(pos,_radius,dx,dz){pos.x+=dx;pos.z+=dz;},settle(){return true;}},
  blockers:()=>[],newInstanceId:()=>++id,canUseItem:()=>false,applyItem:()=>false,carveTarget:()=>null,carve(){},spawnHazards(){},
  emit(e){if(e.type==='action_start')out.starts.push({tick:ctx.tick,actionId:e.actionId,instanceId:e.instanceId});},
  spawnProjectiles(sh,run){
   const c=sh.coefficient[Math.min(run.chargeLevel,sh.coefficient.length-1)];
   out.damage+=sh.count*dataDamage(weapon.attack,c);out.hits+=sh.count;
   out.chargeLevels[run.chargeLevel]=(out.chargeLevels[run.chargeLevel]??0)+1;
   out.hitLog.push({tick:ctx.tick,actionId:run.def.actionId,coefficient:c,count:sh.count});
  },
 };
 function step(input){
  stepPlayer(p,{moveX:0,moveZ:0,pressed:0,held:0,released:0,...input},ctx);
  const ev=p.attackEval;
  if(ev){
   const run=ev.run;
   for(const hw of run.def.hitWindows){
    const key=`${run.instanceId}:${hw.id}`;
    if(ev.t<hw.from||ev.t>=hw.to||hits.has(key))continue;
    assert.equal(hw.maxHitsPerTarget,1,'harness requires one hit per window; update for future schema');
    hits.add(key);
    const charge=run.def.charge;
    let scale=charge?charge.coefficientScale[run.chargeLevel]??1:1;
    const mo=run.def.momentum;
    if(fam.momentum&&mo)scale*=mo.spendScale?mo.spendScale[run.momentumLevel]??1:fam.momentum.damageScale[run.momentumLevel]??1;
    const coefficient=hw.damageCoefficient*scale;
    out.damage+=dataDamage(weapon.attack,coefficient);out.hits++;
    out.nominalEdgeSpent+=hw.damageCoefficient*(fam.edge?.wearPerMotion??0);
    run.hitstop=hw.hitstopTicks+(charge?charge.hitstopBonus[run.chargeLevel]??0:0);
    out.hitLog.push({tick:ctx.tick,actionId:run.def.actionId,coefficient,count:1,window:hw.id});
    if(fam.momentum&&mo?.gain&&!run.momentumGained){
     run.momentumGained=true;p.momentumTicks=0;p.momentum=Math.min(fam.momentum.max,p.momentum+1);
    }
   }
  }
  out.staminaMin=Math.min(out.staminaMin,p.stamina);
  ctx.tick++;
 }
 return {p,ctx,step,out,weapon,fam};
}
function holdFor(p,holds){
 const run=p.action;if(!run?.def.charge)return 0;
 const want=holds[run.def.actionId]??0;
 return run.chargeTicks<want?(run.def.charge.button==='main'?Btn.Main:Btn.Sub):0;
}
function isolated(content,row,level,momentum=0){
 const h=harness(content,row.family,momentum);
 const a=content.actions.get(row.actionId);
 const hold=a.charge&&level>0?a.charge.levelTicks[level-1]:0;
 startAction(h.p,a.actionId,h.ctx);
 for(let i=0;i<1000&&h.p.mode==='action';i++)h.step({held:holdFor(h.p,{[a.actionId]:hold})});
 assert.equal(h.p.mode,'free',a.actionId);
 return {ticks:h.ctx.tick,seconds:h.ctx.tick/60,damage:h.out.damage,hits:h.out.hits,rawDps:h.out.damage*60/h.ctx.tick,staminaSpent:100-h.p.stamina,momentumAtStart:momentum,nominalEdgeCost:h.out.nominalEdgeSpent,rawDamagePerEdge:h.out.nominalEdgeSpent>0?h.out.damage/h.out.nominalEdgeSpent:null};
}
const buttonOf=(fam,id)=>{
 for(const [name,b] of [['main',Btn.Main],['sub',Btn.Sub],['special',Btn.Special]])if(fam.actions[name]===id)return b;
 for(const [name,target]of Object.entries(fam.cancelNames)){
  if(target!==id)continue;
  const b=fam.cancelButtons?.[name]??(target===fam.actions.main?'main':target===fam.actions.sub?'sub':null);
  if(b)return {main:Btn.Main,sub:Btn.Sub,special:Btn.Special}[b];
 }
 return 0;
};
function loop(content,family,names,{hold=0,momentum=0,seconds=60,staminaReserve=0}={}){
 const h=harness(content,family,momentum);
 const route=names.map(n=>`player.${family}.${n}`);
 let next=0,seen=0;
 const startTicks=[];
 for(let t=0;t<seconds*60;t++){
  const want=route[next];
  let pressed=0;
  if(h.p.mode==='free'){
   // Only direct entry actions may start from free. No synthetic access to combo-only finishers.
   assert.ok(Object.values(h.fam.actions).includes(want),`illegal free entry: ${want}`);
   if(h.p.stamina>=staminaReserve)pressed=buttonOf(h.fam,want);
  }else if(h.p.action){
   const r=h.p.action;
   if(h.p.stamina>=staminaReserve&&r.hitstop===0&&r.def.cancelWindows.some(c=>r.tick>=c.from&&r.tick<c.to&&c.into.some(n=>h.fam.cancelNames[n]===want)))pressed=buttonOf(h.fam,want);
  }
  const held=holdFor(h.p,Object.fromEntries(route.map(id=>[id,hold])));
  h.step({pressed,held});
  const news=h.out.starts.slice(seen);seen=h.out.starts.length;
  for(const s of news){
   assert.equal(s.actionId,route[next],`unexpected route transition: ${family}`);
   if(next===0)startTicks.push(s.tick);
   next=(next+1)%route.length;
  }
 }
 const repeats=startTicks.length>1?startTicks.slice(1).map((t,i)=>t-startTicks[i]):[];
 return {seconds,damage:h.out.damage,rawDps:h.out.damage/seconds,hits:h.out.hits,starts:h.out.starts.length,
  cycleTicks:repeats,cycleTicksLast:repeats.at(-1)??null,staminaMin:h.out.staminaMin,staminaEnd:h.p.stamina,
  chargeLevels:h.out.chargeLevels,initialMomentum:momentum,route,holdTicks:hold,staminaReserve,nominalEdgePerSecond:h.out.nominalEdgeSpent/seconds};
}

const actions=[];
for(const row of manifest.rows){
 const levels=row.charge?row.charge.coefficientScale.map((_,i)=>i):[0];
 for(const level of levels){
  const item={family:row.family,actionId:row.actionId,name:row.name,chargeLevel:level,
   current:isolated(contents.current,row,level),proposed:isolated(contents.proposed,row,level)};
  if(row.momentum){item.currentMomentum3=isolated(contents.current,row,level,3);item.proposedMomentum3=isolated(contents.proposed,row,level,3);}
  actions.push(item);
 }
}
const routes=[
 ['heavy_blade',['overhead'],'縦斬り単発',{}],
 ['heavy_blade',['side_sweep','overhead'],'横薙ぎ→縦斬り',{}],
 ...[30,60,90].map((hold,i)=>['heavy_blade',['overhead'],`溜め${i+1}反復`,{hold}]),
 ['guard_blade',['slash1'],'始動だけ反復',{}],
 ['guard_blade',['slash1','slash2','thrust'],'主3段',{}],
 ['guard_blade',['slash1','slash2','thrust','bash'],'主3段→盾',{}],
 ['guard_blade',['slash1','bash'],'始動→盾だけ',{}],
 ['war_maul',['smash'],'始動だけ反復',{}],
 ['war_maul',['smash','swing'],'主2段',{}],
 ...[0,30,60,95].map((hold,i)=>['war_maul',['charge'],`溜め${i}反復`,{hold}]),
 ['war_maul',['charge','swing'],'最大溜め→横殴り',{hold:95}],
 ['twin_blades',['slash1'],'始動だけ反復',{}],
 ['twin_blades',['slash1','slash2','cross'],'主3段・勢い蓄積',{}],
 ['twin_blades',['slash1','stab'],'右斬り→二段突き',{}],
 ['twin_blades',['slash1','slash2','cross','flurry'],'主3段→連ね斬り',{}],
 ['twin_blades',['flurry'],'勢いゼロ連ね斬り反復',{}],
 ['long_blade',['kesa'],'始動だけ反復',{}],
 ['long_blade',['kesa','rise','thrust'],'主3段',{}],
 ['long_blade',['kesa','rise','thrust','helm'],'主3段→兜割り',{}],
 ['long_blade',['kesa','back_cut'],'始動→下がり斬り',{}],
 ['long_blade',['helm'],'兜割り単発反復',{}],
 ['long_lance',['thrust1'],'始動だけ反復',{}],
 ['long_lance',['thrust1','thrust2','thrust3'],'主3段',{}],
 ['long_lance',['thrust1','high'],'始動→上段だけ',{}],
 ...[0,30,70,120].map((hold,i)=>['ring_bow',['shot'],`溜め${i}を狙って射撃60秒`,{hold}]),
 ['ring_bow',['spread'],'散らし3本全命中',{}],
 ['ring_bow',['shot'],'最大溜めを狙って射撃300秒',{hold:120,seconds:300}],
 ['ring_bow',['shot'],'最大溜め・スタミナ24回復を待つ300秒',{hold:120,seconds:300,staminaReserve:24}],
 ['ring_bow',['shot','spread','spread','spread'],'最大溜め→散らし3回300秒',{hold:120,seconds:300}],
];
const loops=routes.map(([family,route,name,opts])=>({family,name,current:loop(contents.current,family,route,opts),proposed:loop(contents.proposed,family,route,opts)}));

// Conservative actor-local envelope of active weapon capsules, including the previous
// tick swept segment and unblocked root movement, sampled at quarter ticks. This is
// descriptive geometry, not a guaranteed hit range or a target hit probability.
const geometry=manifest.rows.map(row=>{
 const c=contents.proposed,a=c.actions.get(row.actionId),curve=c.curves.get(a.rootMotion.curveId);
 if(!a.hitWindows.length)return {actionId:row.actionId,projectile:true,criticalDistanceMeters:[6,12],note:'Projectile trajectory/range is handled by simulation; weapon shape is not the arrow hitbox.'};
 const lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};
 for(const hw of a.hitWindows){
  const tr=c.tracks.get(hw.shapeTrack);
  for(let t=Math.max(0,hw.from-1);t<=hw.to-1;t+=.25){
   const seg=trackSegment(tr,t),root=curve?sampleCurve(curve,t+1):0;
   for(const p of [seg.a,seg.b])for(const axis of ['x','y','z']){
    const v=p[axis]+(axis==='z'?root:0);
    lo[axis]=Math.min(lo[axis],v-tr.radius);hi[axis]=Math.max(hi[axis],v+tr.radius);
   }
  }
 }
 return {actionId:row.actionId,projectile:false,min:lo,max:hi,lateralWidthMeters:hi.x-lo.x,forwardReachMeters:hi.z,note:'Fixed facing, unobstructed root, capsule envelope. Rotation, target shape, current distance and collision obstruction change actual hit chances.'};
});

const checks=[];
function check(name,fn){fn();checks.push({name,pass:true});}
check('All 33 damaging action IDs and all 38 melee hit windows covered',()=>{
 assert.equal(manifest.rows.length,33);assert.equal(manifest.rows.reduce((n,r)=>n+r.hitWindows.length,0),38);
 for(const f of familyIds){
  const actual=[...contents.current.actions.values()].filter(a=>a.actionId.startsWith(`player.${f}.`)&&(a.hitWindows.length||a.shoot?.length));
  assert.deepEqual(actual.map(a=>a.actionId).sort(),manifest.rows.filter(r=>r.family===f).map(r=>r.actionId).sort());
 }
});
check('Actual hit/projectile ticks, cancel windows, root motion, turning, and hitstop preserved',()=>{
 for(const row of manifest.rows){
  const a=contents.current.actions.get(row.actionId),b=contents.proposed.actions.get(row.actionId);
  for(const key of ['durationTicks','rootMotion','turning','cancelWindows','weaponTrack','counter','invulnerable','guardWindows','momentum','staminaCost'])assert.deepEqual(a[key],b[key],row.actionId+' '+key);
  const hw=x=>x.hitWindows.map(({damageCoefficient,...v})=>v);
  assert.deepEqual(hw(a),hw(b),row.actionId);
  const shots=x=>x.shoot?.map(({coefficient,...v})=>v);
  assert.deepEqual(shots(a),shots(b),row.actionId);
  if(a.charge){const {coefficientScale:_,...ca}=a.charge;const {coefficientScale:__,...cb}=b.charge;assert.deepEqual(ca,cb);}
 }
});
check('All weapon active phases contain their real hit/projectile ticks',()=>{
 for(const a of contents.proposed.actions.values()){
  if(!familyIds.some(f=>a.actionId.startsWith(`player.${f}.`)))continue;
  const active=a.phases.filter(p=>p.id==='active');
  for(const hw of a.hitWindows)assert.ok(active.some(p=>p.from<=hw.from&&p.to>=hw.to),a.actionId+' '+hw.id);
  for(const sh of a.shoot??[])assert.ok(active.some(p=>p.from<=sh.tick&&p.to>sh.tick),a.actionId+' shoot');
 }
});
check('Full primary combos beat opener-only repetition in the controlled timing model',()=>{
 for(const family of ['guard_blade','war_maul','twin_blades','long_blade','long_lance']){
  const r=loops.filter(r=>r.family===family);
  const opener=r.find(r=>r.name==='始動だけ反復');
  const combo=r.find(r=>/^主[23]段($|・)/.test(r.name));
  assert.ok(combo.proposed.rawDps>opener.proposed.rawDps,`${family}: ${combo.proposed.rawDps} > ${opener.proposed.rawDps}`);
 }
});
check('Lance three-stage combo beats thrust1/high bypass in the controlled timing model',()=>{
 const r=loops.filter(r=>r.family==='long_lance');
 assert.ok(r.find(r=>r.name==='主3段').proposed.rawDps>r.find(r=>r.name==='始動→上段だけ').proposed.rawDps);
});
check('Charge tier single-action nominal DPS is monotonic including wait and hitstop',()=>{
 for(const actionId of ['player.heavy_blade.overhead','player.war_maul.charge','player.ring_bow.shot']){
  const rows=actions.filter(r=>r.actionId===actionId);
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].proposed.rawDps>rows[i-1].proposed.rawDps,`${actionId} charge ${i}`);
 }
});
check('Twin flurry final paired hits carry more than half of action coefficient',()=>{
 const a=contents.proposed.actions.get('player.twin_blades.flurry');
 const total=a.hitWindows.reduce((n,h)=>n+h.damageCoefficient,0);
 const last=a.hitWindows.filter(h=>h.from===56).reduce((n,h)=>n+h.damageCoefficient,0);
 assert.ok(last/total>.5);assert.ok(last/total<.65);
});

await mkdir(REPORT,{recursive:true});
const report={
 baseCommit:manifest.baseCommit,method:'Actual stepPlayer timing; forced first-active-tick hits; damage uses computeDamage. No geometry, monster AI, incoming damage, fatigue of player, edge degradation or arrow flight. All outcomes are controlled model outputs, NOT gameplay difficulty measurements.',
 assumptions:{tickRate:60,starterWeapons:true,hitzone:1,sharpness:1,crit:1,questScale:1,allWindowsHit:true,allArrowsHit:true,edgeWear:false,enemyAi:false,manualSkill:false},
 checks,actions,loops,geometry,
};
await writeFile(resolve(REPORT,'balance-runtime-report.json'),JSON.stringify(report,null,2)+'\n');
const md=['# 攻撃力・行動時間の比較（実コードを用いた制御試験）','','基点: `'+manifest.baseCommit+'`。人が遊んだ結果ではない。`stepPlayer` の時間・溜め・最速の合法派生・ヒットストップ・勢い・スタミナ回復を実行し、各判定を有効開始時に必ず当てる。部位、刃、会心、依頼の倍率は1。刃の消耗・敵AI・移動の阻害・矢の飛行時間は除外。係数の比較用で、討伐DPSの保証ではない。','','|武器|入力の反復|現行 raw DPS|提案 raw DPS|提案 最後の周期tick|提案 最小スタミナ|','|---|---|---:|---:|---:|---:|',...loops.map(r=>`|${contents.proposed.families.get(r.family).name}|${r.name}|${r.current.rawDps.toFixed(2)}|${r.proposed.rawDps.toFixed(2)}|${r.proposed.cycleTicksLast??'—'}|${r.proposed.staminaMin.toFixed(1)}|`),'','検査: '+checks.length+'項目すべて通過。全結果・各技の待ち時間込みの値は `balance-runtime-report.json`。',''];
await writeFile(resolve(REPORT,'balance-runtime-report.md'),md.join('\n'));
console.log(JSON.stringify({checks:checks.length,actions:actions.length,loops:loops.length,summary:loops.map(r=>({family:r.family,name:r.name,before:r.current.rawDps,after:r.proposed.rawDps,minStamina:r.proposed.staminaMin}))},null,2));
await server.close();
