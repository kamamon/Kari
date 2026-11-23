// 入力のまとめ役。タッチ・キーボード・ゲームパッドは、ここで共通の InputAction（Btn と移動軸）へ変換される。
// pressed / held / released を分けて持ち、simulation が 1 tick に 1 回 sample() で取り出す。
import { Btn, type InputFrame } from '../game/inputFrame';

export type Device = 'touch' | 'keyboard' | 'gamepad';
export type UiAction = 'menu' | 'camReset' | 'verify' | 'return';

export { Btn };

export class InputHub {
  private heldBy: Record<Device, number> = { touch: 0, keyboard: 0, gamepad: 0 };
  private axes: Record<Device, { x: number; y: number }> = { touch: { x: 0, y: 0 }, keyboard: { x: 0, y: 0 }, gamepad: { x: 0, y: 0 } };
  private pendPressed = 0;
  private pendReleased = 0;
  private lookX = 0;
  private lookY = 0;
  private uiListeners: ((a: UiAction) => void)[] = [];
  /** 最後に使われた機器。操作表示の切り替えに使う。 */
  lastDevice: Device = 'keyboard';

  private merged(): number {
    return this.heldBy.touch | this.heldBy.keyboard | this.heldBy.gamepad;
  }

  setButton(dev: Device, btn: number, down: boolean): void {
    const before = this.merged();
    if (down) this.heldBy[dev] |= btn;
    else this.heldBy[dev] &= ~btn;
    const after = this.merged();
    // 同じボタンを複数の指・機器で押しても、押下は 1 回だけ発火する
    if (down && !(before & btn)) this.pendPressed |= btn;
    if (!down && before & btn && !(after & btn)) this.pendReleased |= btn;
    if (down) this.lastDevice = dev;
  }

  /** 移動軸。x は右が正、y は前（画面奥）が正。 */
  setAxis(dev: Device, x: number, y: number): void {
    this.axes[dev].x = x;
    this.axes[dev].y = y;
    if (x !== 0 || y !== 0) this.lastDevice = dev;
  }

  /** 視点の移動量（ラジアン相当）を積む。描画フレームごとに consumeLook() で取り出す。 */
  addLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  consumeLook(): { x: number; y: number } {
    const r = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  /** 押してすぐ離した扱いの入力を 1 回だけ積む（メニューからのリタイアなど）。 */
  pulse(btn: number): void {
    this.pendPressed |= btn;
  }

  ui(action: UiAction): void {
    for (const l of this.uiListeners) l(action);
  }

  onUi(l: (a: UiAction) => void): void {
    this.uiListeners.push(l);
  }

  isHeld(btn: number): boolean {
    return (this.merged() & btn) !== 0;
  }

  /** ある機器の入力をすべて離す（pointercancel・切断・フォーカス喪失など）。 */
  releaseDevice(dev: Device): void {
    const held = this.heldBy[dev];
    for (let b = 1; b <= Btn.Retire; b <<= 1) if (held & b) this.setButton(dev, b, false);
    this.axes[dev].x = 0;
    this.axes[dev].y = 0;
  }

  /** 画面非表示・回転・メニュー表示など。押しっぱなしを残さない。 */
  releaseAll(): void {
    this.releaseDevice('touch');
    this.releaseDevice('keyboard');
    this.releaseDevice('gamepad');
    this.lookX = 0;
    this.lookY = 0;
  }

  /** 1 tick 分の入力を作る。camYaw はカメラの向き（スティック上 = カメラの前方向）。 */
  sample(camYaw: number): InputFrame {
    let ax = 0;
    let ay = 0;
    let best = 0;
    for (const a of Object.values(this.axes)) {
      const m = a.x * a.x + a.y * a.y;
      if (m > best) {
        best = m;
        ax = a.x;
        ay = a.y;
      }
    }
    const mag = Math.sqrt(best);
    if (mag > 1) {
      ax /= mag;
      ay /= mag;
    }
    const s = Math.sin(camYaw);
    const c = Math.cos(camYaw);
    const frame: InputFrame = {
      // 前 = (sin, cos)、右 = (-cos, sin)
      moveX: s * ay - c * ax,
      moveZ: c * ay + s * ax,
      held: this.merged(),
      pressed: this.pendPressed,
      released: this.pendReleased,
    };
    this.pendPressed = 0;
    this.pendReleased = 0;
    return frame;
  }
}
