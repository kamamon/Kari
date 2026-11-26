// Node.js >=22; read-only validation. Run at the repository root.
// Does not claim PSP footage was observed or accept gameplay visual quality.
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), base=path.join(root,'chatgpt-inbox/011');
const files=fs.readdirSync(base).filter(x=>x.endsWith('.json') && x!=='INDEX.json');
const canonical=new Map();
for(const f of fs.readdirSync(path.join(root,'public/data/actions')).filter(x=>x.endsWith('.json'))){
  const data=JSON.parse(fs.readFileSync(path.join(root,'public/data/actions',f),'utf8'));
  for(const a of data.actions||[])canonical.set(a.actionId,a);
}
const die=(x)=>{throw Error(x)};
let n=0, action=0, states=0, incomplete=0, multi=0;
for(const file of files){
  const v=JSON.parse(fs.readFileSync(path.join(base,file),'utf8')); n++;
  if(!v.kariActionId||!v.observed2gMove||!Array.isArray(v.source)||!v.source.length)die(file+': missing identity/source');
  if(!Array.isArray(v.keys)||v.keys.length<5)die(file+': fewer than five keys');
  for(const k of ['K0','K1','K3','K4'])if(!v.keys.some(x=>x.key===k))die(file+': missing '+k);
  if(!v.keys.some(x=>x.key==='K2'||/^K2[a-z]$/.test(x.key)))die(file+': missing K2 or K2a');
  if(v.keys.some(x=>/^K2[a-z]$/.test(x.key)))multi++;
  for(const s of v.source)if(!s.url||!s.edition||!s.from||!s.to||!s.note)die(file+': incomplete source');
  for(const k of v.keys){
    if(!k.support||!k.pelvis||!k.chest||!k.weapon||!k.feet?.L||!k.feet?.R||!k.root||!k.notes||!k.time)die(file+': incomplete '+k.key);
    if(k.feet.L.length!==3||k.feet.R.length!==3)die(file+': invalid foot triple');
    if(!['height','yaw','pitch','roll'].every(z=>typeof k.pelvis[z]==='number'))die(file+': invalid pelvis');
    if(!['yaw','pitch','roll'].every(z=>typeof k.chest[z]==='number'))die(file+': invalid chest');
    if(!(Array.isArray(k.weapon.grip)||typeof k.weapon.grip==='string')||!(Array.isArray(k.weapon.tip)||typeof k.weapon.tip==='string'))die(file+': missing grip/tip');
    if(Array.isArray(k.weapon.grip)&&k.weapon.grip.length!==3)die(file+': invalid grip');
    if(Array.isArray(k.weapon.tip)&&k.weapon.tip.length!==3)die(file+': invalid tip');
  }
  if(!v.weaponPath||!v.rootMotion||!v.contactEvents||!v.differencesFromKari||!Array.isArray(v.unknowns)||!v.unknowns.length)die(file+': missing narrative');
  if(!v.evidenceStatus&&!v.verification)die(file+': missing evidence status');
  if(v.kariActionId.startsWith('player.')){
    const a=canonical.get(v.kariActionId);if(!a)die(file+': action ID missing from main. Use renderer-path ID for non-actions.');
    if(v.kariReference?.durationTicks!==a.durationTicks)die(file+': Kari duration mismatch');
    if(v.kariReference?.clip!==a.clip)die(file+': Kari clip mismatch');
    action++;
  }else if(v.kariActionId.startsWith('src/render/')) states++;
  else die(file+': unsupported ID style');
  if(v.keys.every(k=>k.time==='未測定'))incomplete++;
}
if(n!==130)die('expected 130 JSON observations, got '+n);
console.log(JSON.stringify({result:'STRUCTURE_OK',total:n,actionIds:action,rendererStateRefs:states,multiContactSheets:multi,originalTimeNotMeasured:incomplete,warning:'This checks JSON and Kari IDs; not PSP footage or game pose accuracy'},null,2));
