import {beforeAll,describe,expect,it} from 'vitest';
import type {Content} from '../src/data/schemas';
import {newSave,prepareProvisions} from '../src/save/profile';
import {PROVISIONS} from '../src/game/provisions';
import {loadContent} from './helpers';
let c:Content;beforeAll(async()=>{c=await loadContent()});
describe('携帯食・調合',()=>{it('素材と通貨を消費して道具を作る',()=>{for(const r of PROVISIONS){const d=newSave(c,{now:'x',appVersion:'x',contentVersion:'x'});d.money=r.money;for(const m of r.materials)d.items[m.itemId]=m.count;const n=prepareProvisions(d,c,r.id);expect(n.money).toBe(0);expect(n.items[r.output]).toBe(r.count);for(const m of r.materials)expect(n.items[m.itemId]??0).toBe(0);expect(()=>prepareProvisions(n,c,r.id)).toThrow();expect(d.money).toBe(r.money)}})});
