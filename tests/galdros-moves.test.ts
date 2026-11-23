// ガルドロスの追加の技（v0.4.1）: 噛みつき・頭の横薙ぎ・両前脚・足踏み・のしかかり・体当たり・尾の叩きつけ・
// 逆回りの尾薙ぎ・短い突進・岩飛ばし・尾を切られた後の落石・後ろへ跳ぶ・威嚇。元からある技は galdros.test.ts。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import type { SimEvent } from '../src/game/events';
import type { MonsterState } from '../src/game/monster';
import { Simulation } from '../src/game/sim';
import { baseOptions, loadContent, run } from './helpers';

let content: Content;
beforeAll(async () => {
  content = await loadContent();
});

const G = 'monster.galdros.';
/** ガルドロスを (0,10) に -Z 向きで置き、気付いた状態にして、only の技だけを選べるようにする。 */
function arena(only: string[]): { sim: Simulation; m: MonsterState } {
  const sim = new Simulation(content, baseOptions({ questId: 'quest.basin.003' }));
  const m = sim.monsters[0]!;
  m.pos = { x: 0, y: 0, z: 10 };
  m.prevPos = { ...m.pos };
  m.yaw = Math.PI;
  m.prevYaw = Math.PI;
  m.aware = true;
  m.cooldown = 0;
  const allow = only.map((x) => G + x);
  for (const c of m.def.ai.choices) if (!allow.includes(c.actionId)) m.moveCooldowns[c.actionId] = 1e9;
  return { sim, m };
}
/** モンスターのローカル座標（左 +X、前 +Z）でプレイヤーを置く。 */
function at(sim: Simulation, lx: number, lz: number): void {
  sim.player.pos = { x: -lx, y: 0, z: 10 - lz };
  sim.player.prevPos = { ...sim.player.pos };
}
const started = (ev: SimEvent[], id: string): boolean => ev.some((e) => e.type === 'action_start' && e.actionId === G + id);
const hurts = (ev: SimEvent[]): number[] => ev.filter((e) => e.type === 'player_hurt').map((e) => (e as Extract<SimEvent, { type: 'player_hurt' }>).damage);

describe('ガルドロスの技の数', () => {
  it('技は 20 種類以上、動き（clip）も 20 種類以上ある', () => {
    const acts = [...content.actions.values()].filter((a) => a.actionId.startsWith(G));
    expect(acts.length).toBeGreaterThanOrEqual(20);
    expect(new Set(acts.map((a) => a.clip)).size).toBeGreaterThanOrEqual(20);
    // 行動の選択肢に載っている技は、すべて実在する
    const m = content.monsters.get('monster.galdros')!;
    for (const c of m.ai.choices) expect(content.actions.has(c.actionId), c.actionId).toBe(true);
  });
});

describe('追加の技が、決めた位置の相手に当たる', () => {
  // [技, 左, 前, ダメージ]
  const cases: [string, number, number, number][] = [
    ['bite', 0, 3.4, 24],
    ['head_swing', 0.4, 3.2, 22],
    ['double_slam', 0, 3.6, 36],
    ['stomp', 0.3, 2.6, 16],
    ['body_press', 0, 5.2, 38],
    ['side_bash_l', 2.6, 0, 24],
    ['side_bash_r', -2.6, 0, 24],
    ['tail_slam', 0, -3.6, 30],
    ['tail_sweep_rev', 1.2, -3.2, 26],
    ['charge_short', 0, 7, 28],
  ];
  for (const [id, lx, lz, dmg] of cases) {
    it(`${id}`, () => {
      const { sim } = arena([id]);
      at(sim, lx, lz);
      const ev = run(sim, 170);
      expect(started(ev, id)).toBe(true);
      expect(hurts(ev)).toEqual([dmg]);
    });
  }

  it('離れていれば当たらない（噛みつき・尾の叩きつけ）', () => {
    for (const [id, lx, lz, px, pz] of [['bite', 0, 3.4, 4, 3.4], ['tail_slam', 0, -3.6, 3.5, -3.6]] as const) {
      const { sim } = arena([id]);
      at(sim, lx, lz);
      let ev = run(sim, 20);
      expect(started(ev, id)).toBe(true);
      at(sim, px, pz); // 技が始まってから、横へ離れる
      ev = run(sim, 150);
      expect(hurts(ev)).toEqual([]);
    }
  });
});

describe('岩を打ち上げる技', () => {
  it('岩飛ばし: 前脚の前から 3 個が一列に打ち上がり、最後の 1 個が狙った位置の近くに落ちる', () => {
    const { sim, m } = arena(['rock_fling']);
    at(sim, 0, 10);
    const ev = run(sim, 50);
    expect(started(ev, 'rock_fling')).toBe(true);
    expect(sim.hazards).toHaveLength(3);
    const d = sim.hazards.map((h) => Math.hypot(h.x - m.pos.x, h.z - m.pos.z));
    expect(d[0]!).toBeLessThan(d[1]!);
    expect(d[1]!).toBeLessThan(d[2]!);
    expect(Math.hypot(sim.hazards[2]!.x - sim.player.pos.x, sim.hazards[2]!.z - sim.player.pos.z)).toBeLessThan(0.8);
    for (const h of sim.hazards) expect(h.from).not.toBeNull();
    const after = run(sim, 80);
    expect(hurts(after)).toEqual([20]);
  });

  it('尾を切られた後の落石は、両前脚で地面を叩いて岩を打ち上げる', () => {
    const { sim, m } = arena(['rockfall']);
    m.parts[m.def.parts.findIndex((p) => p.id === 'tail')]!.severed = true;
    at(sim, 0, 9);
    const ev = run(sim, 62);
    expect(started(ev, 'rock_stomp')).toBe(true);
    expect(started(ev, 'rockfall')).toBe(false);
    expect(sim.hazards).toHaveLength(5);
    // 岩は体の前から打ち上がる
    const f = sim.hazards[0]!.from!;
    expect(f.z).toBeLessThan(m.pos.z - 2);
  });

  it('落石の尾の叩きつけは、尾の近くにいると当たる', () => {
    const { sim } = arena(['rockfall']);
    at(sim, 0, -3.6);
    const ev = run(sim, 70);
    expect(hurts(ev)).toEqual([26]);
  });
});

describe('攻撃ではない動き', () => {
  it('後ろへ跳ぶ: 張り付かれると、3m ほど下がる', () => {
    const { sim, m } = arena(['retreat']);
    at(sim, 0, 2.2);
    const z0 = m.pos.z;
    const ev = run(sim, 80);
    expect(started(ev, 'retreat')).toBe(true);
    expect(m.pos.z - z0).toBeGreaterThan(2.8); // -Z を向いているので、後ろは +Z
    expect(hurts(ev)).toEqual([]);
  });

  it('威嚇: 離れた相手へ短く吠える（ダメージは無い）', () => {
    const { sim } = arena(['threat']);
    at(sim, 0, 12);
    const ev = run(sim, 80);
    expect(started(ev, 'threat')).toBe(true);
    expect(hurts(ev)).toEqual([]);
  });
});
