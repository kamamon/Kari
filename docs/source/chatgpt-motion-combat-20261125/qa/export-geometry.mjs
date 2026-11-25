// CPU geometry inspection; no WebGL, texture fetch, or claim of browser playback.
// Usage: node <this-file> <repository-root> <output-directory>
import { build } from 'rolldown';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2]??'.'), out=resolve(process.argv[3]??'tools/out/motion-inspection');
mkdirSync(out,{recursive:true});
const imp=p=>JSON.stringify(join(root,p));
const source=`
import { TextureLoader, Texture, Vector3 } from ${imp('node_modules/three/build/three.module.js')};
import { HunterRig } from ${imp('src/render/rig.ts')};
import { solveState, applySolved, HunterAnimator } from ${imp('src/render/hunterAnim.ts')};
import { clipPose, JOINTS } from ${imp('src/render/poses.ts')};
import { sampleTrack } from ${imp('src/game/tracks.ts')};
${existsSync(join(root,'src/render/heavyBodyMotion.ts'))?`import { groundedHeavyAttack } from ${imp('src/render/heavyBodyMotion.ts')};`:'const groundedHeavyAttack=(p,clip,t)=>p;'}
import { readFileSync, writeFileSync } from 'node:fs';
// Only suppress image loading. All bone, IK, skinning, and mesh calculations run unchanged.
TextureLoader.prototype.load=function(){return new Texture();};
const root=${JSON.stringify(root)}, out=${JSON.stringify(out)};
const rig=new HunterRig();
const families=JSON.parse(readFileSync(root+'/public/data/weapons.json','utf8')).families;
const snapshots=[];
function snapshot(name,meta){
 rig.root.updateMatrixWorld(true);
 const joints=Object.fromEntries(JOINTS.map(n=>[n,rig.joints[n].getWorldPosition(new Vector3()).toArray()]));
 const meshes=[];
 rig.root.traverse(obj=>{
   if(!obj.isMesh)return;
   for(let p=obj;p;p=p.parent)if(!p.visible)return;
   const g=obj.geometry, a=g.getAttribute('position'), points=[], colors=[];
   if(obj.isSkinnedMesh)obj.skeleton.update();
   const c=g.getAttribute('color');
   for(let i=0;i<a.count;i++){
     const v=new Vector3().fromBufferAttribute(a,i);
     if(obj.isSkinnedMesh)obj.applyBoneTransform(i,v);
     v.applyMatrix4(obj.matrixWorld);points.push(v.toArray());
     colors.push(c?[c.getX(i),c.getY(i),c.getZ(i)]:[.55,.55,.55]);
   }
   meshes.push({name:obj.name,points,colors,index:g.index?Array.from(g.index.array):null});
 });
 snapshots.push({name,...meta,joints,meshes});
}
const actions=[];
for(const fam of families){
 const doc=JSON.parse(readFileSync(root+'/public/data/actions/'+fam.id+'.json','utf8'));
 const tracks=JSON.parse(readFileSync(root+'/public/data/tracks/'+fam.id+'.json','utf8')).tracks;
 for(const a of doc.actions){
  if(!a.hitWindows.length&&!a.shoot?.length)continue;
  actions.push({family:fam.id,id:a.actionId,clip:a.clip,duration:a.durationTicks});
 }
 const a=doc.actions.find(a=>a.actionId===fam.actions.main)??doc.actions.find(a=>a.hitWindows.length||a.shoot?.length);
 const tick=a.hitWindows[0]?.from??a.shoot?.[0]?.tick??0;
 rig.setFamily(fam.id,fam.offhand);
 if(fam.id==='heavy_blade'){
  const a=doc.actions.find(a=>a.actionId==='player.heavy_blade.side_sweep');
  for(const t of [18,26,34]){
   const p=groundedHeavyAttack(clipPose(a.clip,t),a.clip,t);rig.setPose(p);
   const tr=tracks.find(tr=>tr.id===a.weaponTrack), s=sampleTrack(tr,t);
   rig.weaponToTrack(s.grip,s.dir,tr.planeNormal??[1,0,0],{two:fam.twoHanded,along:fam.otherHandAlong,primary:fam.primaryHand,other:null});
   snapshot('heavy_sweep_'+t,{family:fam.id,action:a.actionId,tick:t});
  }
 }else{
  const s=solveState(fam.id,{kind:'action',clip:a.clip,t:tick,dirAngle:0,chargeTicks:0,freeMove:false});
  applySolved(rig,s,fam.id);snapshot(fam.id,{family:fam.id,action:a.actionId,tick});
 }
}
// Samples are deliberately spread across a cycle; the baseline solveState bug repeats its phase.
rig.setFamily('guard_blade',families.find(f=>f.id==='guard_blade').offhand);
for(let i=0;i<4;i++){
 const time=i*.16,s=solveState('guard_blade',{kind:'idle'},2.8,time);
 applySolved(rig,s,'guard_blade');snapshot('gait_'+i,{family:'guard_blade',time});
}
writeFileSync(out+'/geometry.json',JSON.stringify({kind:'CPU skinned geometry / no textures / not a gameplay screenshot',actions,snapshots}));
console.log(JSON.stringify({snapshots:snapshots.length,joints:JOINTS.length,out}));
`;
const entry=join(out,'geometry-entry.ts'), bundle=join(out,'geometry-entry.mjs');
writeFileSync(entry,source);
await build({input:entry,platform:'node',plugins:[{name:'cpu-base-url',transform(code,id){if(id.endsWith('/src/core/assets.ts'))return code.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'));}}],output:{file:bundle,format:'esm'},logLevel:'silent'});
await import(pathToFileURL(bundle).href);
