// ゲームパッド（standard mapping）。実機での検証はまだ行っていない（docs/tests.md に未検証と記載）。
// 左スティック 移動 / 右スティック 視点 / X(□) 主攻撃 / Y(△) 副攻撃 / A(×) 回避 / RB 防御・固有
// B(○) 抜刀・納刀 / LB 疾走 / 右スティック押込み 正面復帰 / Start メニュー
import { Btn, type InputHub } from './hub';

const MAP: [number, number][] = [
  [2, Btn.Main],
  [3, Btn.Sub],
  [0, Btn.Dodge],
  [5, Btn.Special],
  [1, Btn.Weapon],
  [4, Btn.Sprint],
];

const dead = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);

export class GamepadInput {
  private prev = new Map<number, boolean>();
  private connected = false;
  enabled = true;

  constructor(private hub: InputHub) {
    window.addEventListener('gamepaddisconnected', () => {
      // 切断時は押しっぱなしを残さない
      this.prev.clear();
      this.connected = false;
      hub.releaseDevice('gamepad');
    });
  }

  update(dt: number): void {
    if (!navigator.getGamepads) return;
    let pad: Gamepad | null = null;
    for (const p of navigator.getGamepads()) {
      if (p && p.connected && p.mapping === 'standard') {
        pad = p;
        break;
      }
    }
    if (!pad) {
      if (this.connected) {
        this.connected = false;
        this.prev.clear();
        this.hub.releaseDevice('gamepad');
      }
      return;
    }
    this.connected = true;
    if (!this.enabled) return;
    this.hub.setAxis('gamepad', dead(pad.axes[0] ?? 0), -dead(pad.axes[1] ?? 0));
    const lx = dead(pad.axes[2] ?? 0);
    const ly = dead(pad.axes[3] ?? 0);
    if (lx || ly) this.hub.addLook(lx * 2.6 * dt, ly * 1.6 * dt);
    for (const [index, btn] of MAP) {
      const down = pad.buttons[index]?.pressed ?? false;
      if (down !== (this.prev.get(index) ?? false)) {
        this.prev.set(index, down);
        this.hub.setButton('gamepad', btn, down);
      }
    }
    const edge = (index: number): boolean => {
      const down = pad!.buttons[index]?.pressed ?? false;
      const was = this.prev.get(index) ?? false;
      this.prev.set(index, down);
      return down && !was;
    };
    if (edge(11)) this.hub.ui('camReset');
    if (edge(9)) this.hub.ui('menu');
  }
}
