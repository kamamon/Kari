import { existsSync,readFileSync } from 'node:fs';
import { beforeAll,describe,expect,it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { Simulation } from '../src/game/sim';
import { applyDamageToMonster,stepMonster } from '../src/game/monster';
import { questMaterials } from '../src/data/validators';
import { questUnlocked,newSave } from '../src/save/profile';
import { iconUrl } from '../src/ui/icons';
import { monsterQuestImageUrl } from '../src/ui/questReception';
import { landscapeProfile } from '../src/render/fieldLandscape';
import { loadContent,baseOptions,frame,Btn } from './helpers';
let c:Content;beforeAll(async()=>{c=await loadContent()});
const id=(r:number)=>'quest.frostald.r'+r;
describe('氷冠獣・白霧氷谷',()=>{
 it('三段階の解禁、狩猟、HPと固有素材',()=>{
  const doc=newSave(c,{now:'2026-11-28T00:00:00Z',appVersion:'test',contentVersion:'test'});
  for(const r of [1,2,3]){
   const q=c.quests.get(id(r))!;expect(q.fieldId).toBe('field.whitefrost');expect(q.board?.stars).toBe(r*2);expect(questUnlocked(doc,q)).toBe(false);for(const req of q.requires??[])doc.progress.questClears[req]=1;expect(questUnlocked(doc,q)).toBe(true);
   const s=new Simulation(c,baseOptions({questId:id(r),field:true}));const m=s.monsters[0]!;expect(m.hp).toBe([1750,3700,6400][r-1]);expect(m.def.element).toBe('ice');expect(s.field?.id).toBe('field.whitefrost');expect(s.monsterArea(m)?.id).toBe('a3');
   const mats=[...questMaterials(c,q)].filter(x=>x.startsWith('mat.frostald.'));expect(mats).toHaveLength([6,7,8][r-1]!);expect(mats.every(x=>x.endsWith('.r'+r))).toBe(true);
  }
 });
 it('氷冠破壊で蓄冷容量低下、補給の間は停止',()=>{
  const s=new Simulation(c,baseOptions({questId:id(1)}));const m=s.monsters[0]!;
  m.aware=true;m.aiEnabled=true;m.action=null;m.cooldown=0;
  s.player.pos={...m.pos,z:m.pos.z+5};m.frostald!.charge=20;
  const action=()=>m.action?.def.actionId;
  stepMonster(m,s.player,s);expect(action()).toBe('monster.frostald.recharge');
  const pos={...m.pos};for(let i=1;i<240;i++)stepMonster(m,s.player,s);expect(m.pos).toEqual(pos);expect(m.frostald!.charge).toBe(100);
  const i=m.def.parts.findIndex(x=>x.id==='mane');applyDamageToMonster(m,i,m.def.parts[i]!.breakDurability!+1,'blunt',s);stepMonster(m,s.player,s);expect(m.parts[i]!.broken).toBe(true);expect(m.frostald!.capacity).toBe(55);
 });
 it('各級の尾切断、討伐、剥ぎ取り、帰還',()=>{
  for(const r of [1,2,3]){const s=new Simulation(c,baseOptions({questId:id(r)}));const m=s.monsters[0]!;const t=m.def.parts.findIndex(x=>x.id==='tail');applyDamageToMonster(m,t,m.def.parts[t]!.sever!.threshold+1,'cut',s);expect(m.parts[t]!.severed).toBe(true);applyDamageToMonster(m,0,m.hp+1,'cut',s);s.step(frame());expect(s.hunt?.reason).toBe('slay');for(let i=0;i<3;i++)s.carve('body');s.carve('tail');expect(s.hunt!.loot.filter(x=>x.source==='carve')).toHaveLength(3);expect(s.hunt!.loot.filter(x=>x.source==='severed:tail')).toHaveLength(1);s.step(frame({pressed:Btn.Retire}));expect(s.hunt?.rewards?.money).toBe([850,1800,3600][r-1]);}
 });
 it('9エリア、40採取地点、4採取ツアー、雪と氷の景観',()=>{
  const f=c.fields.get('field.whitefrost')!,g=c.regionalGathering!.get(f.id)!;expect(f.areas).toHaveLength(9);expect(g.nodes).toHaveLength(40);expect(g.quests).toHaveLength(4);expect(f.routes['monster.frostald']?.nest).toBe('a8');expect(landscapeProfile(f.id,f.areas.find(x=>x.id==='a3')!).floor).toBe('frost_ice');expect(landscapeProfile(f.id,f.areas[0]!).floor).toBe('frost_snow');
 });
 it('33武器、15防具、21素材、69アイコン、専用GLB',()=>{
  const ix=JSON.parse(readFileSync(new URL('../tools/frostald/data/icon_index.json',import.meta.url),'utf8')) as Record<string,{file:string}>;expect(Object.keys(ix)).toHaveLength(69);
  for(const [id,x] of Object.entries(ix)){const p='assets/icons/frostald/'+x.file;expect(iconUrl(id)).toBe(import.meta.env.BASE_URL+p);expect(existsSync(new URL('../public/'+p,import.meta.url))).toBe(true)}
  const eq=JSON.parse(readFileSync(new URL('../public/data/equipment_frostald.json',import.meta.url),'utf8'));expect(eq.weapons).toHaveLength(33);expect(eq.armor).toHaveLength(15);expect(eq.recipes).toHaveLength(48);for(const w of eq.weapons)expect(c.weapons.has(w.id)).toBe(c.families.has(w.family));
  const b=readFileSync(new URL('../public/assets/models/monsters/frostald_game.glb',import.meta.url));const j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));expect(j.skins[0].joints).toHaveLength(79);expect(j.animations).toHaveLength(56);expect(j.meshes.flatMap((m:{primitives:{indices:number}[]})=>m.primitives).reduce((n:number,p:{indices:number})=>n+j.accessors[p.indices].count/3,0)).toBe(329250);
  expect(monsterQuestImageUrl(c,'monster.frostald')).toContain('frostald_concept.webp');
 });
});
