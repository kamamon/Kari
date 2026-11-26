import {beforeAll,describe,it,expect} from 'vitest';
import type {Content} from '../src/data/schemas';
import {FieldGatherState} from '../src/game/fieldGather';
import {Simulation} from '../src/game/sim';
import {Btn,baseOptions,loadContent,frame,press,run} from './helpers';
import {questMaterials} from '../src/data/validators';
import {armorTierOf,armorLookKey} from '../src/render/hunterArmor';
let content:Content;
beforeAll(async()=>{content=await loadContent();});
const start=(rank=1)=>new Simulation(content,baseOptions({questId:`quest.explore.basin.r${rank}`,field:true,monsterId:null}));
function stand(sim:Simulation,n:{areaId:string;x:number;z:number},dx=-1.1,dz=0):void{
 sim.areaId=n.areaId;const p=sim.player,x=n.x+dx,z=n.z+dz;
 p.pos={x,y:sim.world.groundHeight(x,z),z};p.prevPos={...p.pos};p.drawn=false;p.grounded=true;p.yaw=0;
}
describe('常設採取と純素材装備',()=>{
 it('61配置、60素材、4級の40抽選表、武器56・防具40・レシピ168がすべて読み込める',()=>{
  const g=content.fieldGathering!;expect(g.nodes).toHaveLength(61);expect(g.materials).toHaveLength(60);expect(g.tables).toHaveLength(40);
  expect(g.weapons).toHaveLength(56);expect(g.armor).toHaveLength(40);expect(g.recipes).toHaveLength(168);expect(g.quests).toHaveLength(4);
  for(const t of g.tables){expect(t.entries.reduce((a,b)=>a+b.weightBps,0)).toBe(10000);for(const e of t.entries)expect(content.materials.has(e.itemId)).toBe(true);}
  for(const q of g.quests){const can=questMaterials(content,q);for(const t of g.tables.filter(t=>t.rankId===q.rankId))for(const e of t.entries)expect(can.has(e.itemId)).toBe(true);}
  for(const r of g.recipes){expect(content.recipes.has(r.id)).toBe(true);const p=r.id.includes('ore_only')?'mat.ore.':'mat.bone.';expect(r.cost.items.every(i=>i.itemId.startsWith(p))).toBe(true);}
  expect(armorTierOf('model.armor.ore.r4')).toBe(14);expect(armorTierOf('model.armor.bone.r4')).toBe(24);expect(armorLookKey({head:14})).not.toBe(armorLookKey({head:24}));
 });
 it('抽選は出発seedで再現し、級の制限・道具の消耗・枯渇を守る',()=>{
  const g=content.fieldGathering!,a=new FieldGatherState(g,'rank.2',123),b=new FieldGatherState(g,'rank.2',123),n=g.nodes.find(n=>n.kind==='mine')!;
  for(let i=0;i<n.uses;i++){const x=a.take(n),y=b.take(n);expect(x).toEqual(y);expect(x).not.toBeNull();expect(content.ranks.get(g.materials.find(m=>m.id===x!.itemId)!.firstRankId)!.order).toBeLessThanOrEqual(2);}
  expect(a.take(n)).toBeNull();expect(a.left(n)).toBe(0);expect(a.toolLeft.mine).toBe(g.toolCharges.mine-n.uses);expect(a.hash()).toBe(b.hash());
 });
 it('従来納品の5件には影響せず、狩猟と遠征で採取が有効になる',()=>{
  const old=new Simulation(content,baseOptions({questId:'quest.mine.001',field:true,monsterId:null}));expect(old.fieldGather).toBeNull();
  const hunt=new Simulation(content,baseOptions({questId:'quest.basin.003',field:true}));expect(hunt.fieldGather).not.toBeNull();
  expect(start().monsters).toHaveLength(0);
 });
 it('採取行動から報酬へ進み、帰還で持ち帰る',()=>{
  const s=start(),g=s.fieldGather!,n=g.nodes.find(n=>n.kind==='plant'&&n.areaId==='camp')!;
  stand(s,n);expect(s.errandTarget()).toMatchObject({kind:'field_node',nodeId:n.id});
  const ev=run(s,200,i=>i===0?press(Btn.Main):frame());expect(ev.filter(e=>e.type==='field_gather')).toHaveLength(1);
  expect(g.left(n)).toBe(n.uses-1);const loot=[...s.hunt!.loot];expect(loot.length).toBeGreaterThan(0);
  stand(s,s.errand!.def.depot);expect(s.errandTarget()?.kind).toBe('deliver');
  run(s,600,i=>i===0?press(Btn.Main):frame());expect(s.hunt!.closed).toBe(true);expect(s.hunt!.phase).toBe('success');
  for(const l of loot)expect(s.hunt!.rewards!.items.some(i=>i.itemId===l.itemId)).toBe(true);
 });
 it('釣りの食いつき入力だけが魚を取得し、未入力は枯渇させない',()=>{
  const s=start(),g=s.fieldGather!,n=g.nodes.find(n=>n.kind==='fish')!;
  stand(s,n,0,-.8);expect(s.errandTarget()).toMatchObject({kind:'field_node',source:'fish'});
  run(s,260,i=>i===0?press(Btn.Main):frame());expect(g.left(n)).toBe(n.uses);expect(s.hunt!.loot).toHaveLength(0);
  run(s,260,i=>i===0||i===160?press(Btn.Main):frame());expect(g.left(n)).toBe(n.uses-1);expect(s.hunt!.loot.some(l=>l.source==='field_fish')).toBe(true);
 });
});
