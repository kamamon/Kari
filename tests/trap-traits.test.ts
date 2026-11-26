import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { validateTrapProfiles } from '../src/data/validators';
import { trapGroundContact, trapHoldTicks, trapSite } from '../src/game/traps';
import { World } from '../src/game/world';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, loadContent, press, run } from './helpers';

let c: Content;
beforeAll(async () => { c = await loadContent(); });
describe('拘束罠の種別相性・接地', () => {
  it('通常・怒り・再発下限、効かない状態を別にする', () => {
    const r=c.elements.trapProfiles!;
    expect(trapHoldTicks(540,0,false,r['monster.galdros'])).toBe(540);
    expect(trapHoldTicks(540,1,false,r['monster.galdros'])).toBe(324);
    expect(trapHoldTicks(540,100,false,r['monster.galdros'])).toBe(60);
    expect(trapHoldTicks(540,0,true,r['monster.tengaro'])).toBe(0);
    expect(trapHoldTicks(540,0,false,r['monster.tengaro'])).toBe(486);
    expect(trapHoldTicks(540,0,false,r['monster.verito'])).toBeGreaterThan(trapHoldTicks(540,0,true,r['monster.lumisca']));
    expect(trapHoldTicks(540,1,true)).toBe(324);
  });
  it('未知種、幼体、範囲外の設定を拒否', () => {
    const ok:string[]=[];validateTrapProfiles(c,ok);expect(ok).toEqual([]);
    const e=JSON.parse(JSON.stringify(c.elements));
    e.trapProfiles['monster.fake']=e.trapProfiles['monster.galdros'];
    e.trapProfiles['monster.kordopil']=e.trapProfiles['monster.galdros'];
    e.trapProfiles['monster.selvark'].repeatScale=1.1;
    const errors:string[]=[];validateTrapProfiles({...c,elements:e},errors);
    expect(errors).toHaveLength(3);
  });
  it('平地に置ける。境界・岩・段差・空中には置けない', () => {
    const world=new World(c.maps.get('map.basin.training')!);
    expect(trapSite(world,{x:0,y:0,z:4},0)).toEqual({x:0,y:0,z:4.9});
    expect(trapSite(world,{x:0,y:0,z:29.2},0)).toBeNull();
    expect(trapSite(world,{x:-14,y:0,z:-1.1},0)).toBeNull();
    expect(trapSite(world,{x:-32,y:0,z:-27.9},0)).toBeNull();
    expect(trapSite(world,{x:0,y:2,z:4},0)).toBeNull();
    expect(trapGroundContact(world,{x:0,y:0,z:6.5},{x:0,z:4.9})).toBe(true);
    expect(trapGroundContact(world,{x:0,y:1,z:6.5},{x:0,z:4.9})).toBe(false);
  });
  it('設置不可なら道具を消費しない（通常入力）', () => {
    const sim=new Simulation(c,baseOptions({questId:'quest.basin.003'}));
    const p=sim.player;p.pos={x:0,y:0,z:29.2};p.prevPos={...p.pos};p.yaw=0;
    p.itemIndex=p.items.findIndex(s=>s.itemId==='item.bind_trap');
    const stack=p.items[p.itemIndex]!;const before=stack.count;
    const ev=run(sim,1,()=>press(Btn.Item));
    run(sim,150);
    expect(ev.some(e=>e.type==='item_fail')).toBe(true);
    expect(stack.count).toBe(before);expect(sim.traps).toHaveLength(0);
  });
  it('怒り中は発動せず、解除後に同じ罠が発動する', () => {
    const sim=new Simulation(c,baseOptions({questId:'quest.basin.003'}));
    const m=sim.monsters[0]!;
    // 当たり形はガルドロス、種IDのみテンガロにして実行経路を検査。
    m.def={...m.def,id:'monster.tengaro'};m.aiEnabled=false;m.aware=true;m.enraged=true;m.enragedTicks=200;
    m.action=null;m.pos={x:0,y:0,z:6.5};m.prevPos={...m.pos};
    sim.traps.push({id:777,x:0,z:4.9,radius:1.5,holdTicks:540,arm:0,life:1000,state:'armed',target:null});
    run(sim,1);
    expect(m.trapCount).toBe(0);expect(sim.traps[0]!.state).toBe('armed');
    m.enraged=false;run(sim,1);
    expect(m.trapCount).toBe(1);expect(m.trapTicks).toBe(486);expect(sim.traps[0]!.state).toBe('holding');
  });
  it('期限が来た罠は同じtickに敵が踏んでも発動しない', () => {
    const sim=new Simulation(c,baseOptions({questId:'quest.basin.003'}));
    const m=sim.monsters[0]!;m.aiEnabled=false;m.aware=true;m.action=null;m.pos={x:0,y:0,z:6.5};m.prevPos={...m.pos};
    sim.traps.push({id:777,x:0,z:4.9,radius:1.5,holdTicks:540,arm:0,life:1,state:'armed',target:null});
    const ev=run(sim,1);
    expect(m.trapCount).toBe(0);expect(sim.traps).toHaveLength(0);
    expect(ev.some(e=>e.type==='trap_trigger')).toBe(false);
  });
});
