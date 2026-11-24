// 横画面タッチ操作（Pointer Events）。
// pointerId ごとに「移動スティック / 視点 / どのボタン」かの所有者を固定する。
// pointercancel・指の離脱・画面回転・非表示では必ず押下を解除する。
import type { SettingsStore } from '../save/settings';
import { Btn, type InputHub } from './hub';

interface ButtonSpec {
  name: string;
  label: string;
  /** 右端・下端からの距離と直径 (CSS px、buttonScale を掛ける前) */
  x: number;
  y: number;
  s: number;
  btn?: number;
  /** 画面の下・中央を基準に置く（x は中央からの左右のずれ） */
  center?: boolean;
}

export const TOUCH_BUTTONS: ButtonSpec[] = [
  { name: 'main', label: '斬る', x: 104, y: 66, s: 78, btn: Btn.Main },
  { name: 'dodge', label: '回避', x: 20, y: 22, s: 66, btn: Btn.Dodge },
  { name: 'sub', label: '薙ぐ', x: 20, y: 110, s: 64, btn: Btn.Sub },
  { name: 'special', label: '防御', x: 112, y: 162, s: 60, btn: Btn.Special },
  { name: 'weapon', label: '抜刀', x: 24, y: 196, s: 54, btn: Btn.Weapon },
  { name: 'sprint', label: '疾走', x: 204, y: 22, s: 54 },
  { name: 'camreset', label: '正面', x: 200, y: 104, s: 48 },
  // ロックオン（v0.16.0）: 押すたびに入・切。入っている間は明るく光る
  { name: 'lock', label: 'ロック', x: 196, y: 160, s: 48 },
  // 道具: 画面の下・中央。中央が「使う」、左右が切り替え（依頼で道具を持っている時だけ出る）
  { name: 'item', label: '道具', x: 0, y: 10, s: 62, btn: Btn.Item, center: true },
  { name: 'itemprev', label: '◀', x: -62, y: 16, s: 42, btn: Btn.ItemPrev, center: true },
  { name: 'itemnext', label: '▶', x: 62, y: 16, s: 42, btn: Btn.ItemNext, center: true },
];

type Owner = { kind: 'stick'; ox: number; oy: number } | { kind: 'look'; lx: number; ly: number } | { kind: 'button'; name: string } | { kind: 'edit'; name: string; sx: number; sy: number; dx0: number; dy0: number };

export class TouchControls {
  readonly root: HTMLElement;
  private owners = new Map<number, Owner>();
  private counts = new Map<string, number>();
  private els = new Map<string, HTMLElement>();
  private base: HTMLElement;
  private knob: HTMLElement;
  private sprintLatch = false;
  private outerSince = 0;
  private outerSprint = false;
  editing = false;
  enabled = true;

  constructor(
    private hub: InputHub,
    private store: SettingsStore,
    parent: HTMLElement,
  ) {
    const root = document.createElement('div');
    root.id = 'touch';
    this.root = root;
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    root.appendChild(this.base);
    for (const spec of TOUCH_BUTTONS) {
      const el = document.createElement('div');
      el.className = `tbtn tbtn-${spec.name}${spec.center ? ' center' : ''}`;
      el.dataset.name = spec.name;
      el.textContent = spec.label;
      el.style.setProperty('--x', String(spec.x));
      el.style.setProperty('--y', String(spec.y));
      el.style.setProperty('--s', String(spec.s));
      root.appendChild(el);
      this.els.set(spec.name, el);
    }
    parent.appendChild(root);
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('lostpointercapture', (e) => this.up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && root.classList.add('force'), { capture: true });
    store.onChange(() => this.applySettings());
    this.applySettings();
  }

  applySettings(): void {
    const s = this.store.value;
    this.root.classList.toggle('lefty', s.leftHanded);
    this.root.style.setProperty('--btn-scale', String(s.buttonScale));
    this.root.style.setProperty('--btn-opacity', String(s.buttonOpacity));
    for (const [name, el] of this.els) {
      const o = s.layout[name];
      el.style.setProperty('--dx', `${o ? (s.leftHanded ? -o.dx : o.dx) : 0}px`);
      el.style.setProperty('--dy', `${o ? o.dy : 0}px`);
    }
    this.els.get('sprint')!.hidden = s.sprintMode !== 'button';
  }

  /** ボタンを出す / 隠す（道具を持っていない時の道具ボタンなど） */
  setHidden(names: readonly string[], hidden: boolean): void {
    for (const name of names) {
      const el = this.els.get(name);
      if (el && el.hidden !== hidden) el.hidden = hidden;
    }
  }

  /** 押して入・切するボタン（ロック）の、入っている印。 */
  setLatched(name: string, on: boolean): void {
    const el = this.els.get(name);
    if (el && el.classList.contains('latched') !== on) el.classList.toggle('latched', on);
  }

  /** 武器の状態に合わせてボタンの表示名を変える。 */
  setLabels(labels: Partial<Record<string, string>>): void {
    for (const [name, text] of Object.entries(labels)) {
      const el = this.els.get(name);
      if (el && text !== undefined && el.textContent !== text) el.textContent = text;
    }
  }

  setEditing(on: boolean): void {
    this.releaseAll();
    this.editing = on;
    this.root.classList.toggle('editing', on);
  }

  /** すべての指を離した扱いにする。 */
  releaseAll(): void {
    for (const id of this.owners.keys()) {
      try {
        this.root.releasePointerCapture(id);
      } catch {
        // 既に解放済みなら何もしない
      }
    }
    this.owners.clear();
    this.counts.clear();
    for (const el of this.els.values()) el.classList.remove('on');
    this.setSprintLatch(false);
    this.outerSprint = false;
    this.resetStick();
    this.hub.releaseDevice('touch');
  }

  private setSprintLatch(on: boolean): void {
    this.sprintLatch = on;
    this.els.get('sprint')!.classList.toggle('latched', on);
    this.hub.setButton('touch', Btn.Sprint, on || this.outerSprint);
  }

  private resetStick(): void {
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.base.style.bottom = '';
    this.knob.style.transform = '';
    this.hub.setAxis('touch', 0, 0);
  }

  private stickRadius(): number {
    return 56 * this.store.value.buttonScale;
  }

  private inStickZone(x: number, y: number): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const lefty = this.store.value.leftHanded;
    const inX = lefty ? x > w * 0.56 : x < w * 0.44;
    return inX && y > h * 0.22;
  }

  private down(e: PointerEvent): void {
    if (!this.enabled && !this.editing) return;
    if (this.owners.has(e.pointerId)) return;
    e.preventDefault();
    this.hub.lastDevice = 'touch';
    const target = (e.target as HTMLElement).closest<HTMLElement>('.tbtn');
    const capture = (): void => {
      try {
        this.root.setPointerCapture(e.pointerId);
      } catch {
        // 取れなくても pointerup は root へ届く
      }
    };
    if (this.editing) {
      if (!target) return;
      const name = target.dataset.name!;
      const o = this.store.value.layout[name] ?? { dx: 0, dy: 0 };
      this.owners.set(e.pointerId, { kind: 'edit', name, sx: e.clientX, sy: e.clientY, dx0: o.dx, dy0: o.dy });
      capture();
      return;
    }
    if (target) {
      const name = target.dataset.name!;
      this.owners.set(e.pointerId, { kind: 'button', name });
      capture();
      const n = (this.counts.get(name) ?? 0) + 1;
      this.counts.set(name, n);
      if (n > 1) return; // 同じボタンに 2 本目の指が乗っても二重発火させない
      target.classList.add('on');
      const spec = TOUCH_BUTTONS.find((b) => b.name === name)!;
      if (spec.btn) this.hub.setButton('touch', spec.btn, true);
      else if (name === 'sprint') this.setSprintLatch(!this.sprintLatch);
      else if (name === 'camreset') this.hub.ui('camReset');
      else if (name === 'lock') this.hub.ui('lockOn');
      return;
    }
    const hasStick = [...this.owners.values()].some((o) => o.kind === 'stick');
    if (!hasStick && this.inStickZone(e.clientX, e.clientY)) {
      this.owners.set(e.pointerId, { kind: 'stick', ox: e.clientX, oy: e.clientY });
      capture();
      this.base.classList.add('active');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.style.bottom = 'auto';
      return;
    }
    const hasLook = [...this.owners.values()].some((o) => o.kind === 'look');
    if (!hasLook) {
      this.owners.set(e.pointerId, { kind: 'look', lx: e.clientX, ly: e.clientY });
      capture();
    }
  }

  private move(e: PointerEvent): void {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    if (o.kind === 'stick') {
      const r = this.stickRadius();
      let dx = (e.clientX - o.ox) / r;
      let dy = (e.clientY - o.oy) / r;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      this.knob.style.transform = `translate(${dx * r}px, ${dy * r}px)`;
      this.hub.setAxis('touch', dx, -dy);
      if (this.store.value.sprintMode === 'outer') {
        // 外周へ倒し続けた時だけ疾走（短い接触では発動しない）
        const now = performance.now();
        if (m >= 0.98) {
          if (!this.outerSince) this.outerSince = now;
          if (!this.outerSprint && now - this.outerSince > 300) {
            this.outerSprint = true;
            this.hub.setButton('touch', Btn.Sprint, true);
          }
        } else {
          this.outerSince = 0;
          if (this.outerSprint && m < 0.8) {
            this.outerSprint = false;
            this.hub.setButton('touch', Btn.Sprint, this.sprintLatch);
          }
        }
      }
    } else if (o.kind === 'look') {
      const k = 0.0048;
      this.hub.addLook((e.clientX - o.lx) * k, (e.clientY - o.ly) * k);
      o.lx = e.clientX;
      o.ly = e.clientY;
    } else if (o.kind === 'edit') {
      const lefty = this.store.value.leftHanded;
      const dx = o.dx0 + (e.clientX - o.sx) * (lefty ? -1 : 1);
      const dy = o.dy0 + (e.clientY - o.sy);
      const el = this.els.get(o.name)!;
      el.style.setProperty('--dx', `${lefty ? -dx : dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
      el.dataset.dx = String(dx);
      el.dataset.dy = String(dy);
    }
  }

  private up(e: PointerEvent): void {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    this.owners.delete(e.pointerId);
    if (o.kind === 'stick') {
      this.resetStick();
      this.outerSince = 0;
      this.outerSprint = false;
      this.setSprintLatch(false);
    } else if (o.kind === 'button') {
      const n = (this.counts.get(o.name) ?? 1) - 1;
      this.counts.set(o.name, n);
      if (n > 0) return;
      this.els.get(o.name)!.classList.remove('on');
      const spec = TOUCH_BUTTONS.find((b) => b.name === o.name)!;
      if (spec.btn) this.hub.setButton('touch', spec.btn, false);
    } else if (o.kind === 'edit') {
      const el = this.els.get(o.name)!;
      if (el.dataset.dx !== undefined) {
        const layout = { ...this.store.value.layout, [o.name]: { dx: Number(el.dataset.dx), dy: Number(el.dataset.dy) } };
        this.store.set({ layout });
      }
    }
  }
}
