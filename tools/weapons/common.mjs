// ハンターの、武器によらない移動曲線（前転）。gen-weapons.mjs が public/data/curves_player.json へ書き出す（v0.57.0 から。
// それまでは public/data/curves.json に手で書いていた）。
import { curve } from './lib.mjs';

export function common() {
  // 前転（public/data/actions/player_common.json の roll）
  curve('roll_std', [[0, 0], [4, 0.35], [20, 2.9], [28, 3.3], [36, 3.4]]);
}
