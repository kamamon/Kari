import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from './helpers';
import { newRun } from '../src/game/action';
import { EXTRA_FAMILIES, makeExtraWeapon, extraEvent, changeAmmo, resolveExtra, tickExtra, type ExtraWeaponState } from '../src/game/extraWeapons';

let content: Awaited<ReturnType<typeof loadContent>>;
beforeAll(async()=>{content=await loadContent();});
function action(s:ExtraWeaponState,name:string){
  const def=content.actions.get('player.'+s.family+'.'+name);
  if(!def)throw new Error('missing action: '+name);
  return newRun(def,1,0);
}
function commit(s:ExtraWeaponState,name:string){
  const r=action(s,name);
  const t=r.def.phases.find(p=>p.id==='active')?.from ?? r.def.phases.find(p=>p.id==='recovery')!.from;
  extraEvent(s,r,t); return {r,t};
}
describe('11武器種の追加',()=>{
  it('11系統の初期武器が存在し、4新系統に5段階の装備がある',()=>{
    expect([...content.weapons.values()].filter(w=>w.starter)).toHaveLength(11);
    for(const family of EXTRA_FAMILIES){
      expect([...content.weapons.values()].filter(w=>w.family===family)).not.toHaveLength(0);
    }
  });
  it('砲弾は接触時だけ一度消費し、空なら装填へ遷移する',()=>{
    const s=makeExtraWeapon('gunlance')!;
    const {r,t}=commit(s,'shell'); expect(s.loaded).toBe(2);
    extraEvent(s,r,t); expect(s.loaded).toBe(2);
    s.loaded=0;
    expect(resolveExtra(s,'player.gunlance.shell')).toBe('player.gunlance.reload');
    commit(s,'reload'); expect(s.loaded).toBe(3);
    commit(s,'wyvern_fire');expect(s.cooldown).toBeGreaterThan(0);
    expect(resolveExtra(s,'player.gunlance.wyvern_fire')).toBe('player.gunlance.guard');
  });
  it('速射は一つの弾を消費し、弾種変更・装填で弾数が増殖しない',()=>{
    const s=makeExtraWeapon('light_bowgun')!;
    const n=s.loaded;const {r,t}=commit(s,'rapid_fire');expect(s.loaded).toBe(n-1);
    extraEvent(s,r,t);expect(s.loaded).toBe(n-1);
    const total=s.loaded+s.reserve.reduce((a,b)=>a+b,0);
    changeAmmo(s,1);expect(resolveExtra(s,'player.light_bowgun.fire')).toBe('player.light_bowgun.reload');
    commit(s,'reload');expect(s.loadedKind).toBe(1);
    expect(s.loaded+s.reserve.reduce((a,b)=>a+b,0)).toBe(total);
    expect(resolveExtra(s,'player.light_bowgun.rapid_fire')).toBe('player.light_bowgun.fire');
  });
  it('演奏の成立と納刀・死亡時の状態解除',()=>{
    const s=makeExtraWeapon('hunting_horn')!;
    commit(s,'recital_enter');expect(s.recital).toBe(true);
    for(const name of ['play_note1','play_note2','play_note3'])commit(s,name);
    expect(s.buffKind).toBe('attack');expect(s.buff).toBeGreaterThan(0);
    tickExtra(s,false,'idle');expect(s.recital).toBe(false);
    tickExtra(s,false,'dead');expect(s.buff).toBe(0);
  });
  it('重量銃の構え補正は次の一発だけ',()=>{
    const s=makeExtraWeapon('heavy_bowgun')!;
    commit(s,'charge_stance');expect(s.brace).toBe(true);
    expect(commit(s,'fire').r.extraScale).toBe(1.12);expect(s.brace).toBe(false);
    expect(commit(s,'fire').r.extraScale).toBe(1);
    expect(makeExtraWeapon('heavy_blade')).toBeNull();
  });
});
