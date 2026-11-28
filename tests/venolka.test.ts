import { existsSync,readFileSync,statSync } from 'node:fs';
import { beforeAll,describe,it,expect } from 'vitest';
import type { Content } from '../src/data/schemas';
import { Simulation } from '../src/game/sim';
import { stepMonster,applyDamageToMonster,venolkaCan } from '../src/game/monster';
import { newSave,questUnlocked } from '../src/save/profile';
import { iconUrl } from '../src/ui/icons';
import { loadContent,baseOptions,frame,Btn } from './helpers';
let c:Content;beforeAll(async()=>{c=await loadContent()});
const q=(r:number)=>'quest.venolka.r'+r;
describe('毒羽竜ヴェノルカ',()=>{
 it('3級の解禁・体力・根絡み湿原と巣',()=>{
  const doc=newSave(c,{now:'2026-11-28T00:00:00Z',appVersion:'test',contentVersion:'test'});
  for(const r of [1,2,3]){
   const d=c.quests.get(q(r))!;expect(d.fieldId).toBe('field.wetland');expect(questUnlocked(doc,d)).toBe(false);for(const x of d.requires??[])doc.progress.questClears[x]=1;expect(questUnlocked(doc,d)).toBe(true);
   const sim=new Simulation(c,baseOptions({questId:q(r),field:true}));expect(sim.monsters[0]!.hp).toBe([1950,4100,7000][r-1]);expect(sim.monsterArea(sim.monsters[0]!)?.id).toBe('a3');
  }
  expect(c.fields.get('field.wetland')!.routes['monster.venolka']?.nest).toBe('a9');
 });
 it('毒容量、翼・尾羽破壊、級で技を制御する',()=>{
  const s=new Simulation(c,baseOptions({questId:q(1)})),m=s.monsters[0]!;
  expect(venolkaCan(m,'monster.venolka.poison_fan')).toBe(false);
  expect(venolkaCan(m,'monster.venolka.glide')).toBe(true);
  m.aware=true;m.aiEnabled=true;m.action=null;m.cooldown=0;s.player.pos={...m.pos,z:m.pos.z+5};
  m.venolka!.charge=12;stepMonster(m,s.player,s);expect(m.action?.def.actionId).toBe('monster.venolka.refill');
  for(let i=1;i<240;i++)stepMonster(m,s.player,s);
  expect(m.venolka!.charge).toBe(100);
  for(const id of ['sac','wing_l','tail']){const i=m.def.parts.findIndex(p=>p.id===id);applyDamageToMonster(m,i,m.def.parts[i]!.breakDurability!+1,'blunt',s);expect(m.parts[i]!.broken).toBe(true);}
  stepMonster(m,s.player,s);expect(m.venolka!.capacity).toBe(50);expect(venolkaCan(m,'monster.venolka.glide')).toBe(false);expect(venolkaCan(m,'monster.venolka.poison_tail_l')).toBe(false);
 });
 it('解毒薬は毒の蓄積も消す',()=>{
  const s=new Simulation(c,baseOptions({questId:q(1)}));s.player.ailment.poisonTicks=900;s.player.ailment.build.poison=80;expect(s.applyItem(c.items.get('item.antidote')!)).toBe(true);expect(s.player.ailment.poisonTicks).toBe(0);expect(s.player.ailment.build.poison).toBe(0);
 });
 it('全級の狩猟報酬、剥ぎ取り、級別素材',()=>{
  for(const r of [1,2,3]){const s=new Simulation(c,baseOptions({questId:q(r)})),m=s.monsters[0]!;applyDamageToMonster(m,0,m.hp+1,'cut',s);s.step(frame());expect(s.hunt?.reason).toBe('slay');for(let i=0;i<3;i++)s.carve('body');expect(s.hunt!.loot.filter(x=>x.source==='carve')).toHaveLength(3);s.step(frame({pressed:Btn.Retire}));expect(s.hunt?.rewards?.money).toBe([950,1950,3800][r-1]);}
 });
 it('33武器・15防具・69画像。高密度の実体メッシュ111骨、56モーション',()=>{
  const ix=JSON.parse(readFileSync(new URL('../tools/venolka/data/icon_index.json',import.meta.url),'utf8')) as Record<string,{file:string}>;
  expect(Object.keys(ix)).toHaveLength(69);
  for(const [id,x] of Object.entries(ix)){const p='assets/icons/venolka/'+x.file;expect(iconUrl(id)).toBe(import.meta.env.BASE_URL+p);expect(existsSync(new URL('../public/'+p,import.meta.url))).toBe(true);}
  const eq=JSON.parse(readFileSync(new URL('../public/data/equipment_venolka.json',import.meta.url),'utf8'));expect(eq.weapons).toHaveLength(33);expect(eq.armor).toHaveLength(15);expect(eq.recipes).toHaveLength(48);
  const base=new URL('../public/assets/models/monsters/venolka_hd/',import.meta.url);const g=JSON.parse(readFileSync(new URL('venolka.gltf',base),'utf8'));expect(g.skins[0].joints).toHaveLength(111);expect(g.animations).toHaveLength(56);expect(g.materials).toHaveLength(12);expect(g.materials.filter((m:{normalTexture?:unknown})=>m.normalTexture)).toHaveLength(10);
  const tris=g.meshes[0].primitives.reduce((n:number,p:{indices:number})=>n+g.accessors[p.indices].count/3,0);expect(tris).toBeGreaterThan(1900000);for(const b of g.buffers as {uri:string;byteLength:number}[]){expect(statSync(new URL(b.uri,base)).size).toBe(b.byteLength);expect(b.byteLength).toBeLessThan(90000000);}
  for(const a of c.actions.values())if(a.actionId.startsWith('monster.venolka.'))expect(g.animations.some((x:{name:string})=>x.name===a.clip)).toBe(true);
 });
});
