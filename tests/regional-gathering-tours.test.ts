import {beforeAll,describe,it,expect} from 'vitest';
import type {Content} from '../src/data/schemas';
import {gatheringCatalog,fieldGatherMaterials} from '../src/data/fieldGathering';
import {Simulation} from '../src/game/sim';
import {FieldGatherState} from '../src/game/fieldGather';
import {questActivity} from '../src/ui/questReception';
import {Btn,baseOptions,loadContent,frame,press,run} from './helpers';
let c:Content;
beforeAll(async()=>{c=await loadContent();});
describe('全地域の採取ツアー',()=>{
 it('20地域・80遠征。19地域は固有のエリア・採取点・4級抽選を持つ',()=>{
  expect(c.fields.size).toBe(20);
  expect(c.regionalGathering?.size).toBe(19);
  const tours=[...c.quests.values()].filter(q=>q.gather?.fieldGathering);
  expect(tours).toHaveLength(80);
  for(const [id,g] of c.regionalGathering!){
   const f=c.fields.get(id)!;
   expect(f.areas.length).toBeGreaterThanOrEqual(9);
   expect(g.quests).toHaveLength(4);
   expect(new Set(g.nodes.map(n=>n.kind)).size).toBe(5);
   expect(g.tables).toHaveLength(40);
   expect(gatheringCatalog(c,id)).toBe(g);
   for(const q of g.quests){
    expect(questActivity(q)).toBe('tour');
    expect(q.fieldId).toBe(id);
    expect(q.requires??[]).toEqual(c.quests.get('quest.explore.basin.r'+q.rankId.split('.')[1])!.requires??[]);
    expect(q.board?.stars).toBe(2*Number(q.rankId.split('.')[1])-1);
    const m=fieldGatherMaterials(c,q);
    expect(m.some(x=>x.startsWith('mat.field.'+id.slice(6)+'.'))).toBe(true);
   }
  }
 });
 it('19地域それぞれで出発・地域固有の採取と帰還が成立する',()=>{
  for(const [id,g] of c.regionalGathering!){
   const q=g.quests[0]!,s=new Simulation(c,baseOptions({questId:q.id,field:true,monsterId:null}));
   expect(s.field?.id).toBe(id);expect(s.fieldGather?.catalog).toBe(g);
   expect(s.monsters).toHaveLength(0);expect(s.herds).toHaveLength(0);
   const n=g.nodes.find(n=>n.kind==='plant'&&n.areaId==='camp')!;
   const stand=(x:number,z:number)=>{const p=s.player;p.pos={x,y:s.world.groundHeight(x,z),z};p.prevPos={...p.pos};p.drawn=false;p.grounded=true;p.yaw=0;};
   // Stand beside the node and invoke the real gather action.
   stand(n.x-1.1,n.z);
   expect(s.errandTarget()?.kind,id).toBe('field_node');
   run(s,200,i=>i===0?press(Btn.Main):frame());
   const got=s.hunt!.loot.map(l=>l.itemId);expect(got.length,id).toBeGreaterThan(0);
   const depot=q.gather!.depot;stand(depot.x-1.1,depot.z);
   expect(s.errandTarget()?.kind,id).toBe('deliver');
   run(s,600,i=>i===0?press(Btn.Main):frame());
   expect(s.hunt!.phase,id).toBe('success');expect(s.hunt!.closed,id).toBe(true);
   for(const itemId of got)expect(s.hunt!.rewards!.items.some(x=>x.itemId===itemId),id).toBe(true);
  }
 });
 it('全級の抽選は確定的で、地域固有素材の級を越えない',()=>{
  for(const [id,g] of c.regionalGathering!)for(const r of c.ranks.keys()){
   const a=new FieldGatherState(g,r,42),b=new FieldGatherState(g,r,42);
   for(const kind of ['mine','bone','plant','insect','fish']){
    const n=g.nodes.find(n=>n.kind===kind)!;
    const hit=a.take(n);expect(hit).toEqual(b.take(n));expect(hit).not.toBeNull();
    const m=g.materials.find(m=>m.id===hit!.itemId)!;
    expect(c.ranks.get(m.firstRankId)!.order).toBeLessThanOrEqual(c.ranks.get(r)!.order);
   }
  }
 });
});
