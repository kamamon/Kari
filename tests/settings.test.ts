// 操作の設定（localStorage）: v0.40.0 のロックオンのボタン（操作補助）の決め方。
// 新しく始めた人は切（標準は手で視点を回す。2G）。これまで遊んでいた人は入のまま（黙って消さない）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/save/settings';

const KEY = 'veilbound-hunters:prod:settings';
let mem: Map<string, string>;
beforeEach(() => {
  mem = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('ロックオンのボタン（v0.40.0。操作補助）', () => {
  it('新しく始めた人（設定も保存データも無い）は切で、決めた値を残す', () => {
    const s = new SettingsStore();
    expect(s.savedBefore).toBe(false);
    s.settleLockOnButton(s.savedBefore || false);
    expect(s.value.lockOnButton).toBe(false);
    expect(JSON.parse(mem.get(KEY)!).lockOnButton).toBe(false);
  });

  it('設定を保存していた人（v0.39.0 まで。欄が無い）は入のまま。ほかの設定は変えない', () => {
    mem.set(KEY, JSON.stringify({ schemaVersion: 1, invertY: true, buttonScale: 1.2 }));
    const s = new SettingsStore();
    expect(s.savedBefore).toBe(true);
    s.settleLockOnButton(s.savedBefore);
    expect(s.value.lockOnButton).toBe(true);
    expect(s.value.invertY).toBe(true);
    expect(s.value.buttonScale).toBe(1.2);
  });

  it('設定は保存していないが、保存データで遊んでいた人も入のまま', () => {
    const s = new SettingsStore();
    s.settleLockOnButton(s.savedBefore || true);
    expect(s.value.lockOnButton).toBe(true);
  });

  it('一度決めた後は、利用者が変えた値を上書きしない（何度開いても）', () => {
    mem.set(KEY, JSON.stringify({ schemaVersion: 1, lockOnButton: false }));
    const s = new SettingsStore();
    s.settleLockOnButton(true);
    expect(s.value.lockOnButton).toBe(false);
    mem.set(KEY, JSON.stringify({ schemaVersion: 1, lockOnButton: true }));
    const t = new SettingsStore();
    t.settleLockOnButton(false);
    expect(t.value.lockOnButton).toBe(true);
  });
});
