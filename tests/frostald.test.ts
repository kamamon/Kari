import { existsSync,readFileSync,statSync } from 'node:fs';
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
  const b=readFileSync(new URL('../public/assets/models/monsters/frostald_game.glb',import.meta.url));const j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));expect(j.extras.eyeDesign).toBe('calm-blue-v1');expect(j.extras.sculptDesign).toBe('organic-v6');expect(j.extras.materialDesign).toBe('frostald-art-pbr-v2');expect(j.skins[0].joints).toHaveLength(79);expect(j.animations).toHaveLength(56);const tris=j.meshes.flatMap((m:{primitives:{indices:number}[]})=>m.primitives).reduce((n:number,p:{indices:number})=>n+j.accessors[p.indices].count/3,0);expect(tris).toBeGreaterThanOrEqual(300000);expect(tris).toBeLessThanOrEqual(500000);
  expect(monsterQuestImageUrl(c,'monster.frostald')).toContain('frostald_concept.webp');
 });
 it('標準配信の再造形高密度版は約260万三角形・79関節・56クリップ、青い丸瞳孔、100MB制限内',()=>{
  const dir=new URL('../public/assets/models/monsters/frostald_hd/',import.meta.url);
  const g=JSON.parse(readFileSync(new URL('frostald.gltf',dir),'utf8'));
  const info=JSON.parse(readFileSync(new URL('delivery.json',dir),'utf8'));
  expect(g.extras.eyeDesign).toBe('calm-blue-v1');expect(info.eyeDesign).toBe('calm-blue-v1');expect(g.extras.sculptDesign).toBe('organic-v6');expect(info.sculptDesign).toBe('organic-v6');
  expect(g.extras.materialDesign).toBe('frostald-art-pbr-v2');expect(info.materialDesign).toBe('frostald-art-pbr-v2');
  expect(g.skins[0].joints).toHaveLength(79);expect(g.animations).toHaveLength(56);
  const primitives=g.meshes[0].primitives as {indices:number;material:number;attributes:Record<string,number>}[];
  const triangles=primitives.reduce((sum,p)=>sum+g.accessors[p.indices].count/3,0);
  expect(triangles).toBeGreaterThanOrEqual(2400000);expect(triangles).toBeLessThanOrEqual(2850000);
  expect(info.triangles).toBe(triangles);
  for(const b of g.buffers as {uri:string;byteLength:number}[]){
    expect(b.byteLength).toBeLessThan(90000000);expect(statSync(new URL(b.uri,dir)).size).toBe(b.byteLength);
  }
  expect(existsSync(new URL('../public/assets/models/monsters/frostald_master.glb',import.meta.url))).toBe(false);
  const read=(index:number)=>{
    const a=g.accessors[index],v=g.bufferViews[a.bufferView],b=readFileSync(new URL(g.buffers[v.buffer].uri,dir));
    const start=(v.byteOffset??0)+(a.byteOffset??0);
    return new Float32Array(b.buffer,b.byteOffset+start,a.count*3);
  };
  const eye=primitives.find(p=>g.materials[p.material].name==='eye')!,pupil=primitives.find(p=>g.materials[p.material].name==='pupil')!;
  expect(g.materials[eye.material].pbrMetallicRoughness.roughnessFactor).toBe(.32);
  expect(g.materials[eye.material].emissiveFactor??[0,0,0]).toEqual([0,0,0]);
  const colors=read(eye.attributes.COLOR_0!),v=read(pupil.attributes.POSITION!);
  let red=0,blue=0;for(let i=0;i<colors.length;i+=3){red+=colors[i]!;blue+=colors[i+2]!;}expect(blue).toBeGreaterThan(red*1.5);
  let ymin=Infinity,ymax=-Infinity,zmin=Infinity,zmax=-Infinity;
  for(let i=0;i<v.length;i+=3)if(v[i]!>0&&v[i+1]!>1.5){ymin=Math.min(ymin,v[i+1]!);ymax=Math.max(ymax,v[i+1]!);zmin=Math.min(zmin,v[i+2]!);zmax=Math.max(zmax,v[i+2]!);}
  expect((ymax-ymin)/(zmax-zmin)).toBeGreaterThan(.85);expect((ymax-ymin)/(zmax-zmin)).toBeLessThan(1.15);
 });
 it('原画の10素材を実際の高密度メッシュのPBRへ割り当てる',()=>{
  const dir=new URL('../public/assets/models/monsters/frostald_hd/',import.meta.url);
  const g=JSON.parse(readFileSync(new URL('frostald.gltf',dir),'utf8'));
  const expected:Record<string,number>={hide:2048,head_skin:2048,limb_skin:1024,belly_skin:1024,keratin:2048,ice_plate:1024,claw:1024,feather:2048,membrane:1024,mouth:1024};
  const matNames=new Set(g.meshes[0].primitives.map((p:{material:number})=>g.materials[p.material].name));
  for(const [name,res] of Object.entries(expected)){
    expect(matNames.has(name)).toBe(true);
    const m=g.materials.find((x:{name:string})=>x.name===name);
    expect(m.extras.materialDesign).toBe('frostald-art-pbr-v2');expect(m.extras.maps.resolution).toBe(res);
    expect(m.pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(m.extensions.KHR_materials_clearcoat.clearcoatFactor).toBeGreaterThan(0);
    const base=g.images[g.textures[m.pbrMetallicRoughness.baseColorTexture.index].source];
    const normal=g.images[g.textures[m.normalTexture.index].source];
    const orm=g.images[g.textures[m.pbrMetallicRoughness.metallicRoughnessTexture.index].source];
    expect(base.mimeType).toBe('image/jpeg');expect(normal.mimeType).toBe('image/png');expect(orm.mimeType).toBe('image/png');
    expect(m.occlusionTexture.index).toBe(m.pbrMetallicRoughness.metallicRoughnessTexture.index);
    expect(m.extras.maps.normalVariation).toBeGreaterThan(.01);
  }
  expect(g.extras.materialMaps.mouth.roughnessRange[1]).toBeLessThan(g.extras.materialMaps.hide.roughnessRange[0]);
  expect(g.extensionsUsed).toContain('KHR_materials_clearcoat');
 });
});
