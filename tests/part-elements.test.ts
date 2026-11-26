import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { validatePartZones } from '../src/data/validators';
import { typedElementZone, weaponElementHit } from '../src/game/gear';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let c: Content;
beforeAll(async () => { c = await loadContent(); });
describe('部位別属性肉質', () => {
  it('破壊後の明示値・0・従来値の補完を別に扱う', () => {
    const m = c.monsters.get('monster.lumisca')!;
    const p = m.parts.find(x => x.id === 'nodes')!;
    expect(typedElementZone(c,m,p,'thunder')).toBe(0);
    expect(typedElementZone(c,m,p,'thunder',true)).toBe(.12);
    expect(typedElementZone(c,m,p,'ice')).toBe(.40);
    expect(typedElementZone(c,m,p,'water',true)).toBe(p.elementZone);
    const gd = c.monsters.get('monster.galdros')!;
    const h = gd.parts.find(x => x.id === 'head')!;
    expect(typedElementZone(c,gd,h,'fire')).toBeCloseTo(.3);
  });
  it('複合の演出は計算で選ばれた属性。未指定部位では既存式', () => {
    const m=c.monsters.get('monster.lumisca')!, p=m.parts.find(x=>x.id==='nodes')!;
    const w={...c.weapons.get('weapon.heavy_blade.001')!,element:{type:'compound',value:20,elements:['thunder','ice'] as ('thunder'|'ice')[]}};
    expect(weaponElementHit(c,w,m,p)).toEqual({zone:.40,element:'ice'});
    expect(weaponElementHit(c,w,m,p,true)).toEqual({zone:.46,element:'ice'});
  });
  it('種別表の全参照を検証し、誤記・負値・破壊できない部位を拒否', () => {
    const ok:string[]=[];validatePartZones(c,ok);expect(ok).toEqual([]);
    const e=JSON.parse(JSON.stringify(c.elements));
    e.partZones['monster.fake']={head:{normal:{fire:.2}}};
    e.partZones['monster.lumisca'].nodes.normal.thunder=-.1;
    e.partZones['monster.galdros'].body={normal:{foo:.2},broken:{fire:.2}};
    const errors:string[]=[];validatePartZones({...c,elements:e},errors);
    expect(errors).toHaveLength(4);
  });
  it('実命中の属性項に破壊後の値が入る（当たり形は訓練標的）', () => {
    const id='monster.training_dummy';
    const build=(broken:boolean) => {
      const monsters=new Map(c.monsters);
      const dummy=monsters.get(id)!;
      monsters.set(id,{...dummy,parts:dummy.parts.map(p=>p.id==='head'?{...p,breakDurability:10000}:p)});
      const elements={...c.elements,partZones:{...c.elements.partZones,[id]:{head:{normal:{wind:0},broken:{wind:.8}}}}};
      const sim=new Simulation({...c,monsters,elements},baseOptions({weaponId:'weapon.heavy_blade.selvark.r1'}));
      placeInFrontOfHead(sim);
      const m=sim.monsters[0]!;m.parts[m.def.parts.findIndex(p=>p.id==='head')]!.broken=broken;
      const ev=run(sim,90,i=>i===0?press(Btn.Main):frame());
      return ev.find(e=>e.type==='hit'&&e.attacker===sim.player.id);
    };
    const a=build(false),b=build(true);
    if(!a||a.type!=='hit'||!b||b.type!=='hit')throw Error('命中なし');
    expect(a.element).toBeUndefined();expect(b.element).toBe('wind');expect(b.damage).toBeGreaterThan(a.damage);
  });
});
