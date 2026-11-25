import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SkillEngine, type Definition, type SkillEvent} from './skill-engine.ts';
const data = new URL('../data/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json',data),'utf8')) as {mechanics:string[]};
const definitions = index.mechanics.flatMap(p=>JSON.parse(fs.readFileSync(new URL(p,data),'utf8')) as Definition[]);
test('All 688 actual catalog mechanics activate at all 774 supported definition/level pairs',()=>{
  let checked=0;
  for(const d of definitions) for(const level of (d.id.startsWith('signature.')?[1,2]:[1]) as (1|2)[]) {
    const s=new SkillEngine([{definition:d,level}]);
    const tags=[...d.trigger.tagsAll,...d.trigger.tagsAny.slice(0,1)];
    for(let i=0;i<d.hitsRequired;i++) {
      const e:SkillEvent={id:`trigger${i}`,actionId:`action${i}`,tick:i,event:d.trigger.event,targetId:'monsterA',tags,hp:d.trigger.hpMin,stamina:d.trigger.staminaMin};
      s.handle(e);
    }
    const active=JSON.parse(s.stateJSON()).states[0][1].proc as {effects:Record<string,number>;originActionId:string}|undefined;
    assert.ok(active,`${d.id} Lv${level} failed to activate`);
    for(const e of d.effects) assert.equal(active.effects[e.stat],e.values[level-1],`${d.id} ${e.stat} Lv${level}`);
    assert.equal(active.originActionId,`action${d.hitsRequired-1}`);
    checked++;
  }
  assert.equal(definitions.length,688); assert.equal(checked,774);
});
