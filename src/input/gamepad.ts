// ゲームパッド（standard mapping）。実機での検証はまだ行っていない（docs/tests.md に未検証と記載）。
// v0.40.0 から PSP の 2G の並びに寄せた（docs/spec.md の 32.2）:
// 左スティック 移動 / 右スティック 視点 / Y(△) 主攻撃 / B(○) 副攻撃（Y と B の同時押しで複合の技）/ A(×) 回避
// X(□) 道具（抜刀中は納刀）/ RB 防御・固有（納刀中は疾走。2G の R）/ LB 背後へ戻す（2G の L）/ LT 抜刀・納刀
// 十字の左右 道具の切り替え / RT ロックオン（操作補助）/ 右スティック押込み 背後へ戻す / Start メニュー
import { Btn, type InputHub } from './hub';

const MAP: [number, number][] = [
  [3, Btn.Main],
  [1, Btn.Sub],
  [0, Btn.Dodge],
  [2, Btn.Item],
  [5, Btn.Special | Btn.Sprint],
  [6, Btn.Weapon],
  [14, Btn.ItemPrev],
  [15, Btn.ItemNext],
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
    if (edge(11) || edge(4)) this.hub.ui('camReset');
    // 右トリガー: ロックオンの切り替え
    if (edge(7)) this.hub.ui('lockOn');
    if (edge(9)) this.hub.ui('menu');
  }
}
