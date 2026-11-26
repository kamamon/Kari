// エリアの色合いと風の音（v0.51.0。#19 の F06「色と音の作り分け」。docs/spec.md の 32.17）: データ（field:gen の出力）と検査。
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FieldDef } from '../src/data/schemas';
import { validateField } from '../src/data/validators';
import { loadContent } from './helpers';

let content: Content;
let field: FieldDef;
beforeAll(async () => {
  content = await loadContent();
  field = content.fields.get('field.basin')!;
});
const errorsOf = (f: FieldDef): string[] => {
  const errors: string[] = [];
  validateField(content, f, errors);
  return errors;
};

describe('エリアの色合いと風の音（#19 の F06。v0.51.0）', () => {
  it('どのエリアにも色合いと風があり、広く開けた原・台地は風が強く、狭い谷・沢・巣は弱い。エリア 3（これまでの狩場）は色を変えない', () => {
    const look = (id: string): { ground?: [number, number, number]; wind?: number } => field.areas.find((a) => a.id === id)!.look!;
    for (const a of field.areas) {
      expect(a.look, a.id).toBeDefined();
      expect(a.look!.ground, a.id).toHaveLength(3);
    }
    for (const id of ['a2', 'a7']) for (const n of ['a5', 'a8', 'a10']) expect(look(id).wind!, `${id} > ${n}`).toBeGreaterThan(look(n).wind!);
    expect(look('a3').ground).toEqual([1, 1, 1]);
    expect(look('a3').wind).toBe(1);
    // どのエリアも、隣り合うエリアのどれかと色合いが違う（同じ色の続きにしない）
    for (const a of field.areas) {
      if (a.id === 'camp' || a.id === 'a3') continue;
      const differs = a.exits.some((e) => JSON.stringify(look(e.to).ground) !== JSON.stringify(a.look!.ground));
      expect(differs, a.id).toBe(true);
    }
  });

  it('検査が誤りを見つける: 色の倍率が範囲の外・数が違う・風が 1.6 を超える', () => {
    const bad = structuredClone(field);
    bad.areas[1]!.look = { ground: [1.5, 1, 1], wind: 1 };
    bad.areas[2]!.look = { ground: [1, 1] as unknown as [number, number, number] };
    bad.areas[3]!.look = { wind: 2.2 };
    const e = errorsOf(bad);
    expect(e.filter((x) => /look\.ground が不正/.test(x))).toHaveLength(2);
    expect(e.some((x) => /look\.wind が不正/.test(x))).toBe(true);
    expect(errorsOf(field)).toEqual([]);
  });
});
