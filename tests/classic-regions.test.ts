import {beforeAll,describe,expect,it} from 'vitest';
import {Simulation} from '../src/game/sim';
import {baseOptions,frame,loadContent} from './helpers';
import type {Content} from '../src/data/schemas';
let c:Content;beforeAll(async()=>{c=await loadContent()});
describe('追加19狩場',()=>{
 it('201エリアのうち追加190区域・243往復接続と地域依頼を保持',()=>{
  const all=[...c.fields.values()].filter(f=>f.id.startsWith('field.classic_'));
  expect(all).toHaveLength(19);expect(all.reduce((n,f)=>n+f.areas.length,0)).toBe(190);
  expect(all.reduce((n,f)=>n+f.areas.reduce((s,a)=>s+a.exits.length,0),0)).toBe(486);
  for(const f of all){const q=[...c.quests.values()].find(q=>q.fieldId===f.id&&q.kind==='gather');expect(q,f.id).toBeDefined();expect(f.legacyMapId).toBe(q!.mapId);}
 });
 it('全19狩場の接続を実際のSimulationの出口処理で往復確認',()=>{
  for(const f of c.fields.values()){
   if(!f.id.startsWith('field.classic_'))continue;
   const q=[...c.quests.values()].find(q=>q.fieldId===f.id&&q.kind==='gather')!;
   const sim=new Simulation(c,baseOptions({questId:q.id,field:true}));
   expect(sim.areaId,f.id).toBe(f.start.areaId);
   for(const a of f.areas)for(const e of a.exits){
    sim.areaId=a.id;sim.player.pos={x:e.x,y:sim.world.groundHeight(e.x,e.z),z:e.z};sim.player.prevPos={...sim.player.pos};
    sim.step(frame());sim.drainEvents();expect(sim.areaId,f.id+': '+a.id+'→'+e.to).toBe(e.to);
    expect(sim.player.pos.x).toBeCloseTo(e.arrive.x,3);expect(sim.player.pos.z).toBeCloseTo(e.arrive.z,3);
    sim.step(frame());expect(sim.areaId).toBe(e.to);
   }
  }
 });
});
