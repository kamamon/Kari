import {beforeAll,describe,expect,it} from 'vitest';
import type {Content} from '../src/data/schemas';
import {classicSkillLevel,emptyClassicGear,JEWELS,socketCapacity,classicSkillPoints} from '../src/game/classicGear';
import {newSave,readSave,changeClassicGear,defenseOf} from '../src/save/profile';
import {loadContent} from './helpers';
let c:Content;beforeAll(async()=>{c=await loadContent()});
describe('classic equipment',()=>{
it('signed thresholds',()=>{expect([9,10,14,15,20,-9,-10,-15].map(p=>classicSkillLevel('guard_economy',p))).toEqual([0,1,1,2,3,0,-1,-2])});
it('v5 migration preserves existing inventory',()=>{const d=newSave(c,{now:'x',appVersion:'x',contentVersion:'x'});const v={...d,schemaVersion:5,classicGear:undefined,money:432};const r=readSave(v);expect(r.kind).toBe('ok');if(r.kind==='ok'){expect(r.doc.money).toBe(432);expect(r.doc.classicGear).toEqual(emptyClassicGear());}});
it('forge, socket, return and fortify',()=>{const d=newSave(c,{now:'x',appVersion:'x',contentVersion:'x'});d.money=10000;d.items['mat.ore.basin_iron']=20;const a=c.armor.get('armor.head.selvark.r1')!;d.armor.push(a.id);d.equippedArmorIds=[a.id];const j=JEWELS[0]!;const made=changeClassicGear(d,c,'craft',j.id);const attached=changeClassicGear(made,c,'attach',a.id,j.id);expect(attached.classicGear!.stock[j.id]).toBe(0);expect(attached.classicGear!.sockets[a.id]).toEqual([j.id]);const detached=changeClassicGear(attached,c,'detach',a.id,j.id);expect(detached.classicGear!.stock[j.id]).toBe(1);const f=changeClassicGear(detached,c,'fortify',a.id);expect(defenseOf(f,c)).toBe(defenseOf(detached,c)+2);expect(socketCapacity(c,a.id)).toBeGreaterThan(0);expect(classicSkillPoints(c,[a],d.equippedWeaponId,attached.classicGear!).get('guard_economy')).toBeDefined()});
});
