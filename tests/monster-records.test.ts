import {beforeAll,describe,it,expect} from 'vitest';
import {accumulateMonsterRecords,monsterRecordErrors,recordSizeText} from '../src/save/monsterRecords';
import {newSave,settleRun,readSave} from '../src/save/profile';
import {loadContent} from './helpers';
import type {Content} from '../src/data/schemas';
let c:Content;beforeAll(async()=>{c=await loadContent()});
describe('狩猟個体記録',()=>{
 it('同一種の最小・最大と討伐・捕獲を別々に記録',()=>{
 const id='monster.galdros';const old={[id]:{minPct:100,maxPct:100,slain:1,captured:0}};
 const result=accumulateMonsterRecords(old,[{speciesId:id,sizePct:93,outcome:'capture'},{speciesId:id,sizePct:111,outcome:'slay'}]);
 expect(result[id]).toEqual({minPct:93,maxPct:111,slain:2,captured:1});expect(old[id]!.minPct).toBe(100);
 expect(recordSizeText(result[id]!,8.5)).toContain('小型記録');expect(recordSizeText(result[id]!,8.5)).toContain('大型記録');
 });
 it('依頼精算と同じrunIdで二重記録しない・失敗は記録しない',()=>{
 const d=newSave(c,{now:'x',contentVersion:'x',appVersion:'x'});
 const r={runId:'size-test',questId:'quest.basin.003',money:1,items:[],individuals:[{speciesId:'monster.galdros',sizePct:98,outcome:'slay' as const}]};
 const n=settleRun(d,r)!;expect(n.monsterRecords?.['monster.galdros']?.slain).toBe(1);expect(settleRun(n,r)).toBeNull();
 expect(settleRun(d,{...r,cleared:false})).toBeNull();
 expect(readSave(n).kind).toBe('ok');
 });
 it('不正値・標的・未知の失敗を記録しない',()=>{
 expect(monsterRecordErrors({'monster.galdros':{minPct:113,maxPct:90,slain:0,captured:0}}).length).toBeGreaterThan(0);
 expect(accumulateMonsterRecords(undefined,[{speciesId:'monster.training_dummy',sizePct:100,outcome:'slay'},{speciesId:'monster.galdros',sizePct:Infinity,outcome:'capture'}])).toEqual({});
 });
});
