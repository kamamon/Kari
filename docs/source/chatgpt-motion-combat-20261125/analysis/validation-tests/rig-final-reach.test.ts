// Validation source: copy this file to <disposable applied repository>/tests/ to run.
import { it, expect, vi } from 'vitest';
import { TextureLoader, Texture, Vector3, Quaternion } from 'three';
import { writeFileSync } from 'node:fs';
import { HunterRig } from '../src/render/rig';
import { clipPose } from '../src/render/poses';
import { groundedHeavyAttack } from '../src/render/heavyBodyMotion';
import { sampleTrack } from '../src/game/tracks';
import { loadContent } from './helpers';
const deg=(x:number)=>x*180/Math.PI;
const bend=(a:Vector3,b:Vector3,c:Vector3)=>180-deg(a.clone().sub(b).angleTo(c.clone().sub(b)));
it('quarter-tick final heavy poses preserve both hand positions and bound knees', async()=>{
 const mock=vi.spyOn(TextureLoader.prototype,'load').mockImplementation(()=>new Texture());
 const content=await loadContent(),rig=new HunterRig();
 const rows:any[]=[];
 for(const name of ['overhead','side_sweep','draw_slash']){
  const a=content.actions.get(`player.heavy_blade.${name}`)!,tr=content.tracks.get(a.weaponTrack!)!;
  const stats:any={name,maxMiss:0,maxMissActive:0,maxKneeFlex:0,maxElbowFlex:0,minRigidSoleY:Infinity,samples:0};
  for(let t=0;t<=a.durationTicks;t+=.25){
   const p=groundedHeavyAttack(clipPose(a.clip,t)!,a.clip,t);
   rig.setPose(p);const k=sampleTrack(tr,t);
   rig.weaponToTrack(k.grip,k.dir,tr.planeNormal??[1,0,0],{two:true,along:.2});rig.root.updateMatrixWorld(true);
   const rg=new Vector3(k.grip.x,k.grip.y,k.grip.z),lg=rg.clone().addScaledVector(new Vector3(k.dir.x,k.dir.y,k.dir.z).normalize(),.2);
   const miss=Math.max(rig.sockets.hand_r.getWorldPosition(new Vector3()).distanceTo(rg),rig.sockets.hand_l.getWorldPosition(new Vector3()).distanceTo(lg));
   if(miss>stats.maxMiss){stats.maxMiss=miss;stats.worstTick=t;}
   if(a.hitWindows.some(w=>t>=w.from&&t<w.to))stats.maxMissActive=Math.max(stats.maxMissActive,miss);
   for(const side of ['L','R'] as const){
    const at=(key:any)=>rig.joints[key as keyof typeof rig.joints].getWorldPosition(new Vector3());
    stats.maxKneeFlex=Math.max(stats.maxKneeFlex,bend(at(`thigh${side}`),at(`shin${side}`),at(`foot${side}`)));
    stats.maxElbowFlex=Math.max(stats.maxElbowFlex,bend(at(`upperArm${side}`),at(`forearm${side}`),at(`hand${side}`)));
    for(const z of [-.065,.13,.175]){const y=rig.joints[`foot${side}`].localToWorld(new Vector3(0,-.04,z)).y;if(y<stats.minRigidSoleY){stats.minRigidSoleY=y;stats.worstSoleTick=t;}}
   }
   stats.samples++;
  }
  rows.push(stats);
  expect(stats.maxMiss,`${name} both hands distance`).toBeLessThan(.002);
  expect(stats.maxKneeFlex,`${name} knee flex`).toBeLessThan(150);
 }
 mock.mockRestore();writeFileSync('rig-final-reach.results.json',JSON.stringify(rows,null,2));
});
