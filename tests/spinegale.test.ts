import { existsSync,readFileSync } from 'node:fs';
import { beforeAll,describe,expect,it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { Simulation } from '../src/game/sim';
import { applyDamageToMonster, stepMonster } from '../src/game/monster';
import { questUnlocked,newSave } from '../src/save/profile';
import { questMaterials } from '../src/data/validators';
import { iconUrl } from '../src/ui/icons';
import { monsterQuestImageUrl } from '../src/ui/questReception';
import { loadContent,baseOptions,frame,Btn } from './helpers';
let content:Content;
beforeAll(async()=>{content=await loadContent()});
const id=(r:number)=>'quest.spinegale.r'+r;
describe('疾棘竜の本体統合',()=>{
  it('三段階の依頼、HP、解禁順と級別の素材',()=>{
    const doc=newSave(content,{now:'2026-11-28T00:00:00.000Z',appVersion:'test',contentVersion:'test'});
    for(const r of [1,2,3]){
      const q=content.quests.get(id(r))!;
      expect(q.targetMonsterId).toBe('monster.spinegale');expect(q.rankId).toBe('rank.'+r);
      expect(q.board?.stars).toBe(r*2);expect(q.timeLimitTicks).toBe([54000,108000,144000][r-1]);
      expect(questUnlocked(doc,q)).toBe(false);
      for(const req of q.requires??[])doc.progress.questClears[req]=1;
      expect(questUnlocked(doc,q)).toBe(true);
      const sim=new Simulation(content,baseOptions({questId:id(r)}));
      expect(sim.monsters[0]!.hp).toBe([1450,3200,5800][r-1]);
      expect(sim.monsterAttackScale).toBeCloseTo([1,1.55,2.15][r-1]!);
      const own=[...questMaterials(content,q)].filter(m=>m.startsWith('mat.spinegale.'));
      expect(own).toHaveLength([6,7,8][r-1]!);
      for(const m of own)expect(m.endsWith('.r'+r)).toBe(true);
    }
  });
  it('初級600・中級540・上級480tickの停止。怒りで上書きされない',()=>{
    for(const r of [1,2,3]){
      const sim=new Simulation(content,baseOptions({questId:id(r)}));
      const m=sim.monsters[0]!;
      m.aware=true;m.aiEnabled=true;m.action=null;m.enraged=true;m.enragedTicks=1200;m.pendingRoar=true;m.spinegale!.stamina=20;
      const actionId=()=>m.action?.def.actionId;
      const pos={...m.pos};const ticks=[600,540,480][r-1]!;
      for(let t=0;t<ticks;t++){
        stepMonster(m,sim.player,sim);
        expect(m.pos).toEqual(pos);expect(m.attackEval).toBeNull();
        expect(actionId()).toContain('monster.spinegale.fatigue_');
      }
      expect(m.spinegale!.remaining).toBe(0);expect(m.spinegale!.stamina).toBe(m.spinegale!.max);
      stepMonster(m,sim.player,sim);expect(actionId()).toBe(m.def.rage!.actionId);
    }
  });
  it('三段階の部位破壊・尾切断・討伐・剥ぎ取り・帰還報酬',()=>{
    for(const r of [1,2,3]){
      const sim=new Simulation(content,baseOptions({questId:id(r)}));
      const m=sim.monsters[0]!;
      const tail=m.def.parts.findIndex(p=>p.id==='tail');
      applyDamageToMonster(m,tail,m.def.parts[tail]!.sever!.threshold+1,'cut',sim);
      expect(m.parts[tail]!.severed).toBe(true);
      expect(sim.severedAt.tail).toBeDefined();
      applyDamageToMonster(m,0,m.hp+1,'cut',sim);
      sim.step(frame());
      expect(sim.hunt?.phase).toBe('success');expect(sim.hunt?.reason).toBe('slay');
      for(let i=0;i<3;i++)sim.carve('body');
      sim.carve('tail');
      expect(sim.hunt!.loot.filter(x=>x.source==='carve')).toHaveLength(3);
      expect(sim.hunt!.loot.filter(x=>x.source==='severed:tail')).toHaveLength(1);
      sim.step(frame({pressed:Btn.Retire}));
      expect(sim.hunt?.rewards?.money).toBe([700,1600,3200][r-1]);
      expect(sim.hunt!.rewards!.items.every(x=>x.itemId.endsWith('.r'+r))).toBe(true);
    }
  });
  it('全69アイコンの対応、既存系統だけを生産可能にする',()=>{
    const idx=JSON.parse(readFileSync(new URL('../tools/spinegale/icon_index.json',import.meta.url),'utf8')) as Record<string,string>;
    expect(Object.keys(idx)).toHaveLength(69);
    for(const [key,rel] of Object.entries(idx)){
      const path='assets/icons/spinegale/'+rel.replace(/\.png$/,'.webp');
      expect(iconUrl(key)).toBe(import.meta.env.BASE_URL+path);expect(existsSync(new URL('../public/'+path,import.meta.url))).toBe(true);
    }
    const full=JSON.parse(readFileSync(new URL('../public/data/equipment_spinegale.json',import.meta.url),'utf8')) as {weapons:{id:string;family:string}[],armor:{id:string}[],recipes:unknown[]};
    expect(full.weapons).toHaveLength(33);expect(full.armor).toHaveLength(15);expect(full.recipes).toHaveLength(48);
    for(const w of full.weapons)expect(content.weapons.has(w.id)).toBe(content.families.has(w.family));
    for(const a of full.armor)expect(content.armor.has(a.id)).toBe(true);
    expect(monsterQuestImageUrl(content,'monster.spinegale')).toContain('spinegale_concept_v1.webp');
  });
  it('採用GLBの77関節・53モーション・171772三角形',()=>{
    const b=readFileSync(new URL('../public/assets/models/monsters/spinegale_v3_game.glb',import.meta.url));
    expect(b.toString('ascii',0,4)).toBe('glTF');
    const g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
    expect(g.skins[0].joints).toHaveLength(77);expect(g.animations).toHaveLength(53);
    expect(g.meshes.flatMap((m:{primitives:{indices:number}[]})=>m.primitives).reduce((n:number,p:{indices:number})=>n+g.accessors[p.indices].count/3,0)).toBe(171772);
    for(const a of content.actions.values())if(a.actionId.startsWith('monster.spinegale.'))expect(g.animations.some((x:{name:string})=>x.name===a.clip)).toBe(true);
  });
});
