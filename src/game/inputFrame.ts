// 1 tick 分の入力。タッチ・キーボード・ゲームパッドはすべてこの形へ変換してから simulation へ渡す。
// moveX / moveZ はワールド座標の移動方向（大きさ 0〜1）。カメラの向きは入力側で反映済み。

export const Btn = {
  Main: 1,
  Sub: 2,
  Dodge: 4,
  Special: 8,
  Weapon: 16,
  Sprint: 32,
  Item: 64,
  ItemPrev: 128,
  ItemNext: 256,
  /** 依頼のリタイア。入力として記録するので、再生でも同じ tick に終わる。 */
  Retire: 512,
  /**
   * 主と副の同時押し（複合入力。v0.40.0、docs/spec.md の 32 章）。タッチは専用の小さなボタン、キーボードは V、
   * パッドとマウスは主と副を同じ tick に押すと、simulation がこれと同じに扱う。断岳剣の斬り上げ。
   */
  Combo: 1024,
} as const;

/** 全部のボタンの印（押しっぱなしを離す時に使う） */
export const BTN_ALL = 2047;

export interface InputFrame {
  moveX: number;
  moveZ: number;
  /** 押している間ずっと立つ */
  held: number;
  /** 押した瞬間の tick だけ立つ */
  pressed: number;
  /** 離した瞬間の tick だけ立つ */
  released: number;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({ moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 });
