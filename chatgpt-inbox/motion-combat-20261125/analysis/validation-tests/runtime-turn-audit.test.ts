// Validation source: copy this file to <disposable applied repository>/tests/ to run.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { HunterAnimator } from '../src/render/hunterAnim';
import { WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import { checkFrame } from '../src/render/humanLimits';
import { loadContent } from './helpers';
it('audits actual animator during abrupt 90/180 degree movement turns',async()=>{
 const content=await loadContent(),rows:any[]=[];
 for(const fam of Object.keys(WEAPON_STANCES))for(const turn of [Math.PI/2,Math.PI])for(const fps of [30,60,120]){
  const anim=new HunterAnimator(),speed=content.families.get(fam)!.drawnMoveSpeed;
  const turnRate=content.families.get(fam)!.drawnTurnDegPerSec*Math.PI/180;
  let x=0,z=0,yaw=0;const violations:any[]=[];let maxLegShort=0,maxHandMiss=0;
  for(let i=0;i<fps*3;i++){
   const dt=1/fps,want=i<fps*.6?0:turn;
   const dif=Math.atan2(Math.sin(want-yaw),Math.cos(want-yaw));yaw+=Math.sign(dif)*Math.min(Math.abs(dif),turnRate*dt);
   const moving=i<fps*2.2;x+=moving?Math.sin(want)*speed*dt:0;z+=moving?Math.cos(want)*speed*dt:0;
   const s=anim.frame(fam,{kind:'idle'},'idle',dt,moving?speed:0,i/fps,{root:{x,z,yaw}});
   maxLegShort=Math.max(maxLegShort,s.frames.legShortL,s.frames.legShortR);
   maxHandMiss=Math.max(maxHandMiss,Math.hypot(...s.frames.handL.map((v,j)=>v-s.frames.targetL[j]!)),Math.hypot(...s.frames.handR.map((v,j)=>v-s.frames.targetR[j]!)));
   for(const v of checkFrame(s,WEAPON_STANCES[fam]!.hands,WEAPON_STANCES[fam]!.shape))if(!v.rule.startsWith('重心'))violations.push({t:i/fps,...v});
  }
  const rules:any={};for(const v of violations){const e=rules[v.rule];if(!e||Math.abs(e.value)<Math.abs(v.value))rules[v.rule]=v;}
  rows.push({fam,turn:Math.round(turn*180/Math.PI),fps,maxLegShort,maxHandMiss,rules,count:violations.length});
  expect(maxLegShort,`${fam} turn ${turn} fps ${fps} leg reach`).toBeLessThan(.012);
  expect(violations,`${fam} turn ${turn} fps ${fps} joint/hand/self-contact limits`).toEqual([]);
 }
 writeFileSync('runtime-turn.results.json',JSON.stringify(rows,null,2));expect(rows).toHaveLength(36);
});
