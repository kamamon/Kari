import {beforeAll,describe,it,expect} from 'vitest';
import type {Content} from '../src/data/schemas';
import {weaponEdgeProfile,weaponEdgeRules} from '../src/game/weaponEdge';
import {computeDamage,edgeStage} from '../src/game/combat';
import {Simulation} from '../src/game/sim';
import {baseOptions,loadContent} from './helpers';
let c:Content;
beforeAll(async()=>{c=await loadContent()});
describe('武器ごとの刃の分布',()=>{
 it('初期装備を維持し、系列・級で分布を変える',()=>{
  expect(weaponEdgeRules(c,'weapon.heavy_blade.001')).toBe(c.edge);
  const a=weaponEdgeRules(c,'weapon.heavy_blade.selvark.r1'),b=weaponEdgeRules(c,'weapon.heavy_blade.selvark.r4');
  expect(b.max).toBeGreaterThan(a.max);expect(b.max-b.stages[0]!.min).toBeGreaterThan(a.max-a.stages[0]!.min);
  expect(edgeStage(b,b.max).id).toBe('keen');expect(edgeStage(b,0).id).toBe('dull');
 });
 it('全武器の分布、弓は旧表示',()=>{for(const w of c.weapons.values()){const p=weaponEdgeProfile(w);if(p)expect(p.max>p.keen&&p.keen>p.worn&&p.worn>0).toBe(true)}expect(weaponEdgeRules(c,'weapon.ring_bow.001')).toBe(c.edge)});
 it('属性の刃補正は物理と別',()=>{const d={attack:100,motion:1,sharpness:1,hitzone:1,crit:1,element:20,elementMotion:1,elementZone:1,questModifier:1};expect(computeDamage({...d,elementSharpness:.5})).toBe(110)});
 it('狩猟開始・研磨上限',()=>{const id='weapon.heavy_blade.selvark.r4',sim=new Simulation(c,baseOptions({weaponId:id}));const max=weaponEdgeRules(c,id).max;expect(sim.player.edge).toBe(max);sim.player.edge=1;expect(sim.applyItem(c.items.get('item.whetstone')!)).toBe(true);expect(sim.player.edge).toBe(max)});
});
