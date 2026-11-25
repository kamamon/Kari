// PC の初期割当（設計書 p.08）。
// 移動 WASD / 疾走 Shift / 視点 中ボタンドラッグ・矢印キー / 背後へ戻す F / 主攻撃 左クリック / 副攻撃 右クリック
// 主と副の同時押し（複合入力。v0.40.0）: 左右のクリックを同時に、または V
// 回避 Space / 防御・固有 Ctrl または C / 抜刀・納刀 R / 道具 E（抜刀中は納刀） / メニュー Esc / 検証表示 F3
import { Btn, type InputHub } from './hub';

const KEY_BTN: Record<string, number> = {
  Space: Btn.Dodge,
  ControlLeft: Btn.Special,
  ControlRight: Btn.Special,
  KeyC: Btn.Special,
  KeyR: Btn.Weapon,
  ShiftLeft: Btn.Sprint,
  ShiftRight: Btn.Sprint,
  KeyE: Btn.Item,
  KeyQ: Btn.ItemPrev,
  KeyV: Btn.Combo,
};

export class KeyboardMouse {
  private down = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  enabled = true;

  constructor(
    private hub: InputHub,
    private canvas: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.release());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        hub.setButton('keyboard', e.deltaY > 0 ? Btn.ItemNext : Btn.ItemPrev, true);
        hub.setButton('keyboard', e.deltaY > 0 ? Btn.ItemNext : Btn.ItemPrev, false);
      },
      { passive: false },
    );
  }

  release(): void {
    this.down.clear();
    this.dragging = false;
    this.hub.releaseDevice('keyboard');
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (e.code === 'Escape') {
      if (isDown && !e.repeat) this.hub.ui('menu');
      return;
    }
    if (!this.enabled) return;
    if (e.code === 'F3') {
      e.preventDefault();
      if (isDown && !e.repeat) this.hub.ui('verify');
      return;
    }
    if (e.code === 'KeyF') {
      if (isDown && !e.repeat) this.hub.ui('camReset');
      return;
    }
    if (e.code === 'KeyT') {
      if (isDown && !e.repeat) this.hub.ui('lockOn');
      return;
    }
    const btn = KEY_BTN[e.code];
    const isMove = e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD';
    const isArrow = e.code.startsWith('Arrow');
    if (!btn && !isMove && !isArrow) return;
    e.preventDefault();
    if (isDown) this.down.add(e.code);
    else this.down.delete(e.code);
    if (btn && !e.repeat) this.hub.setButton('keyboard', btn, isDown);
    if (isMove) {
      const x = (this.down.has('KeyD') ? 1 : 0) - (this.down.has('KeyA') ? 1 : 0);
      const y = (this.down.has('KeyW') ? 1 : 0) - (this.down.has('KeyS') ? 1 : 0);
      this.hub.setAxis('keyboard', x, y);
    }
  }

  /** 矢印キーでの視点操作。描画フレームごとに呼ぶ。 */
  update(dt: number): void {
    if (!this.enabled) return;
    const x = (this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('ArrowLeft') ? 1 : 0);
    const y = (this.down.has('ArrowDown') ? 1 : 0) - (this.down.has('ArrowUp') ? 1 : 0);
    if (x || y) this.hub.addLook(x * 2.2 * dt, y * 1.4 * dt);
  }

  private onMouse(e: MouseEvent, isDown: boolean): void {
    if (isDown && !this.enabled) return;
    if (e.button === 0) this.hub.setButton('keyboard', Btn.Main, isDown);
    else if (e.button === 2) this.hub.setButton('keyboard', Btn.Sub, isDown);
    else if (e.button === 1) {
      this.dragging = isDown;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (isDown) e.preventDefault();
    }
  }

  private onMove(e: MouseEvent): void {
    if (!this.dragging || !this.enabled) return;
    this.hub.addLook((e.clientX - this.lastX) * 0.005, (e.clientY - this.lastY) * 0.005);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }
}
