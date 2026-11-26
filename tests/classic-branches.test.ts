import {beforeAll,describe,expect,it} from 'vitest';
import type {Content} from '../src/data/schemas';
import {newSave,craft} from '../src/save/profile';
import {loadContent} from './helpers';
let c:Content;
beforeAll(async()=>{c=await loadContent()});
describe('武器派生',()=>{
 it('初期武器の7系統に複数の派生を持つ',()=>{const all=[...c.recipes.values()].filter(r=>r.kind==='upgrade'&&r.branch);expect(all.length).toBe(105);for(const w of c.weapons.values())if(w.starter)expect(all.filter(r=>r.kind==='upgrade'&&r.fromWeaponId===w.id).length).toBeGreaterThan(1);});
 it('派生後は元武器を消費し、直接生産レシピは残る',()=>{const r=[...c.recipes.values()].find(r=>r.kind==='upgrade'&&r.branch)!;if(r.kind!=='upgrade')throw Error();const doc=newSave(c,{now:'x',appVersion:'x',contentVersion:'x'});doc.money=r.cost.money;for(const m of r.cost.items)doc.items[m.itemId]=m.count;const d=craft(doc,r);expect(d.weapons).toContain(r.resultWeaponId);expect(d.weapons).not.toContain(r.fromWeaponId);expect(d.money).toBe(0);expect([...c.recipes.values()].some(x=>x.kind==='craft'&&x.resultWeaponId===r.resultWeaponId)).toBe(true)});
});
