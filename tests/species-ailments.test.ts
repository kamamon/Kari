import { beforeAll, describe, expect, it } from 'vitest';
import { AILMENT_UNIT, addAilment, ailmentThreshold, freshAilments, speciesAilment, startPoison, stepAilments } from '../src/game/ailment';
import type { Content, MonsterAilmentRules, StatusKind } from '../src/data/schemas';
import { validateElementRules } from '../src/data/validators';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, loadContent, placeInFrontOfHead, press, run } from './helpers';

let content: Content;
beforeAll(async () => { content = await loadContent(); });
const rules = (): MonsterAilmentRules => content.elements.ailment;
const ids = ['poison','para','sleep','stun'] as const;
const advance = (a: ReturnType<typeof freshAilments>, n: number, id: string): number => {
  let damage = 0;
  for (let i = 0; i < n; i++) damage += stepAilments(a, rules(), id).poison;
  return damage;
};

describe('種別耐性（Kari固有の値）', () => {
  it('訓練標的は旧規則。未知の種も従来規則を使う', () => {
    for (const id of ['monster.training_dummy','monster.future']) {
      expect([0,1,2,3].map(n => ailmentThreshold(rules(),'poison',n,id)/AILMENT_UNIT)).toEqual([100,135,183,247]);
    }
  });
  it('現行20種の4状態を設定し、最大値を越えない。訓練標的は別', () => {
    const profiles = rules().species!;
    expect(Object.keys(profiles)).toHaveLength(20);
    for (const [id,p] of Object.entries(profiles)) {
      expect(content.monsters.has(id)).toBe(true);
      for (const k of ids) {
        const r = p[k]!;
        if (r.immune) throw Error('現行種は完全免疫にしない');
        expect(ailmentThreshold(rules(),k,0,id)).toBe(r.initial*AILMENT_UNIT);
        expect(ailmentThreshold(rules(),k,1,id)).toBe(Math.min(r.cap,r.initial+r.increase)*AILMENT_UNIT);
        expect(ailmentThreshold(rules(),k,100,id)).toBe(r.cap*AILMENT_UNIT);
      }
    }
  });
  it('同じ量でも睡眠に弱いセルヴァルクと強いアシュレイアは結果が違う', () => {
    const a=freshAilments(), b=freshAilments();
    expect(addAilment(a,rules(),'sleep',80_000,'monster.selvark')).toBe('triggered');
    expect(addAilment(b,rules(),'sleep',80_000,'monster.ashreia')).toBe('stored');
    expect(a.ticks.sleep).toBe(540);
    expect(b.gauge.sleep).toBe(80_000);
  });
  it('免疫は蓄積・回数・発症を変えない', () => {
    const R: MonsterAilmentRules = {...rules(),species:{'monster.test':{sleep:{immune:true}}}};
    const a=freshAilments();
    expect(addAilment(a,R,'sleep',10000000,'monster.test')).toBe('none');
    expect(a).toEqual(freshAilments());
    expect(ailmentThreshold(R,'sleep',0,'monster.test')).toBe(Infinity);
  });
  it('再発耐性と減衰は個体別。加算すると減衰までの時計をリセット', () => {
    const id='monster.selvark',a=freshAilments(),b=freshAilments();
    expect(addAilment(a,rules(),'poison',85_000,id)).toBe('triggered');
    startPoison(a,rules(),1500,id);
    advance(a,840,id);
    expect(ailmentThreshold(rules(),'poison',a.count.poison,id)).toBe(115_000);
    expect(ailmentThreshold(rules(),'poison',b.count.poison,id)).toBe(85_000);
    addAilment(b,rules(),'poison',20_000,id);
    advance(b,299,id);
    expect(b.gauge.poison).toBe(20_000);
    addAilment(b,rules(),'poison',1_000,id);
    advance(b,299,id);
    expect(b.gauge.poison).toBe(21_000);
    advance(b,1,id);
    expect(b.gauge.poison).toBe(14_000);
  });
  it('異なる級のHPでも毒総量は同じ。割り切れない分割も全量を消化する', () => {
    const id='monster.verito';
    for (const hp of [1400,5600]) {
      const a=freshAilments();
      expect(addAilment(a,rules(),'poison',150_000,id)).toBe('triggered');
      startPoison(a,rules(),hp,id);
      expect(advance(a,720,id)).toBe(22);
      expect(a.poisonDone).toBe(10);
    }
    const R:MonsterAilmentRules={...rules(),species:{'monster.test':{poison:{initial:1,increase:0,cap:1,durationTicks:7,decayIntervalTicks:1,decayAmount:0,poisonDamage:13,poisonHits:3}}}};
    const b=freshAilments();addAilment(b,R,'poison',1000,'monster.test');startPoison(b,R,100,'monster.test');
    let sum=0;for(let i=0;i<7;i++)sum+=stepAilments(b,R,'monster.test').poison;
    expect(sum).toBe(13);expect(b.poisonDone).toBe(3);
  });
  it('拘束の猶予を守り、上限の1手前で止める', () => {
    const id='monster.selvark',a=freshAilments();
    addAilment(a,rules(),'para',90_000,id);
    expect(addAilment(a,rules(),'sleep',999_999,id)).toBe('capped');
    expect(a.gauge.sleep).toBe(75_000-1);
    advance(a,132+rules().lockGraceTicks,id);
    expect(a.ticks.sleep).toBe(0);
    expect(addAilment(a,rules(),'sleep',1,id)).toBe('triggered');
  });
  it('不正な上限、状態ID、免疫と数値の併記を読み込み時に拒否する', () => {
    const errors: string[]=[];
    const e=JSON.parse(JSON.stringify(content.elements));
    e.ailment.species['monster.selvark'].para.cap=1;
    e.ailment.species['monster.selvark'].stun={immune:true,initial:10};
    e.ailment.species['monster.selvark'].other={};
    validateElementRules(e,errors);
    expect(errors.filter(x=>x.includes('ailment.species.monster.selvark'))).toHaveLength(3);
  });
  it('simulationの実命中とtick更新が定義IDで同じ種別規則を使う', () => {
    // 当たり形は訓練標的で揃え、耐性だけ実装種へ差し替える。原作実機の試験ではない。
    const id='monster.selvark';
    const monsters=new Map(content.monsters);
    monsters.set(id,{...content.monsters.get('monster.training_dummy')!,id});
    const c={...content,monsters};
    const sim=new Simulation(c,baseOptions({monsterId:id,weaponId:'weapon.heavy_blade.verito.r1'}));
    const m=sim.monsters[0]!;
    placeInFrontOfHead(sim);
    m.ailments.gauge.poison=85_000-1;
    run(sim,100,i=>i===0?press(Btn.Main):frame());
    expect(m.ailments.count.poison).toBe(1);
    expect(m.ailments.poisonTotal).toBe(34);
    expect(m.ailments.ticks.poison).toBeGreaterThan(0);
    expect(m.ailments.ticks.poison).toBeLessThan(840);
  });
});
