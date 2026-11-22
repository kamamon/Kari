// 操作・表示・音量の設定。ゲームのセーブ（M3 で IndexedDB に作る）とは別物で、端末ごとの好みだけを持つ。
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
    layout: {},
  };
}

type Listener = (s: Settings) => void;

export class SettingsStore {
  value: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.value = defaultSettings();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        // 未知の版は読まずに初期値を使う（黙って壊れた値を混ぜない）
        if (parsed.schemaVersion === 1) this.value = { ...this.value, ...parsed, layout: { ...(parsed.layout ?? {}) } };
      }
    } catch {
      // プライベートブラウズ等で localStorage が使えない場合は初期値のまま動かす
    }
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
