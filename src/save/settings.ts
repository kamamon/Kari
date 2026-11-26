// 操作・表示・音量の設定。ゲームのセーブ（持ち物・装備・進行。IndexedDB、saveManager.ts）とは別物で、端末ごとの好みだけを持つ。
// キーはゲーム固有の名前にして、同じドメインの別作品と混ざらないようにする。

export interface Settings {
  schemaVersion: 1;
  camSensitivity: number;
  invertX: boolean;
  invertY: boolean;
  leftHanded: boolean;
  buttonScale: number;
  buttonOpacity: number;
  sprintMode: 'button' | 'outer';
  targetAssist: boolean;
  /**
   * 操作補助: ロックオンのボタン（v0.40.0）。標準は手で視点を回す（2G）。新しく始めた人は切。
   * v0.39.0 までに設定を保存していた人は、これまでどおり入（黙って消さない）
   */
  lockOnButton: boolean;
  shake: 'off' | 'weak' | 'mid';
  fpsCap: 30 | 60;
  renderScale: number;
  shadows: boolean;
  volMaster: number;
  volSe: number;
  volBgm: number;
  volEnv: number;
  mute: boolean;
  verify: boolean;
  dummyAttacks: boolean;
  /**
   * ハンターの動きの組（v0.57.0。D-150）: '2g' = 2G を手本に作り直している動き、'v056' = v0.56.0 までの動き（保留）。
   * 読み込みの時に使う（変えたら読み直す）。知らない値は '2g'（src/render/motionSet.ts の motionSetOf）
   */
  motionSet: string;
  /** ボタンごとの位置ずらし (CSS px) */
  layout: Record<string, { dx: number; dy: number }>;
}

const KEY = 'veilbound-hunters:prod:settings';

export function defaultSettings(): Settings {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return {
    schemaVersion: 1,
    camSensitivity: 1,
    invertX: false,
    invertY: false,
    leftHanded: false,
    buttonScale: 1,
    buttonOpacity: 0.62,
    sprintMode: 'button',
    targetAssist: false,
    lockOnButton: false,
    shake: 'weak',
    fpsCap: 60,
    renderScale: coarse ? 0.85 : 1,
    shadows: !coarse,
    volMaster: 0.8,
    volSe: 0.9,
    volBgm: 0.6,
    volEnv: 0.5,
    mute: false,
    verify: false,
    dummyAttacks: true,
    motionSet: '2g',
    layout: {},
  };
}

type Listener = (s: Settings) => void;

export class SettingsStore {
  value: Settings;
  private listeners: Listener[] = [];
  /** 保存した設定に「ロックオンのボタン」（v0.40.0）がまだ無い */
  private lockKeyMissing = true;
  /** v0.39.0 までの設定を読んだ（これまで遊んでいた人） */
  savedBefore = false;

  constructor() {
    this.value = defaultSettings();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        // 未知の版は読まずに初期値を使う（黙って壊れた値を混ぜない）
        if (parsed.schemaVersion === 1) {
          // 設定を保存していた人は、これまで遊んでいた人
          this.savedBefore = true;
          this.value = { ...this.value, ...parsed, layout: { ...(parsed.layout ?? {}) } };
          this.lockKeyMissing = parsed.lockOnButton === undefined;
        }
      }
    } catch {
      // プライベートブラウズ等で localStorage が使えない場合は初期値のまま動かす
    }
  }

  /**
   * v0.40.0: ロックオンのボタン（操作補助）を、まだ決めていなければ決めて残す。これまで遊んでいた人（保存データがある、
   * または設定を保存していた人）は入のまま（黙って消さない）、新しく始めた人は切（標準は手で視点を回す）。
   */
  settleLockOnButton(existingPlayer: boolean): void {
    if (!this.lockKeyMissing) return;
    this.lockKeyMissing = false;
    this.set({ lockOnButton: existingPlayer });
  }

  set(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // 保存できなくてもプレイは続ける
    }
    for (const l of this.listeners) l(this.value);
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}
