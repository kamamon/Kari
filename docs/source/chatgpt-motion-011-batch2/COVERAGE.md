# 依頼011 第2便 — Kari v0.57.0の行動IDとの対応一覧

固定した比較対象：main `5fb9131920b92f6269c6c5ac45a222a6cbb63ca9` の `public/data/actions/`。**ここは数値のモーション観察票ではない**。現行の行動IDから、文章による照合節への入口を示す表である。

- 各行が示すのは **その技の説明・確認事項が第2便の文章にあること**。実際のPSPの動きを見た／Kariのモーションを検証できたことではない。
- `現行ID` はKari v0.57.0のaction JSONから読み込んだ。後からmainに新アクションが増えた場合はこの表を再照合する。
- 「固有の注意」は対応が誤りやすい技だけ記載。ほかの技でも **足順・刀身の実軌道は未観察**。

| 現行ID | 参照する文章票 | 特に注意する点 |
|---|---|---|
| `player.heavy_blade.overhead` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.heavy_blade.side_sweep` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | PSPは薙ぎ払い（横殴りと混用しない） |
| `player.heavy_blade.draw_slash` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.heavy_blade.upswing` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.heavy_blade.upswing_low` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.heavy_blade.draw` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.heavy_blade.sheathe` | [HEAVY_BLADE.md](HEAVY_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.slash1` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.side` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.slash2` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.return` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.round` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.bash` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 2Gのガード攻撃／盾連係との対応要確認 |
| `player.guard_blade.guard_slash` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | R+△とR+○を一技に混ぜない |
| `player.guard_blade.lunge` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.draw` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.guard_blade.sheathe` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.slash1` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.slash2` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.cross` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.round` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.stab` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | Kari旧二段突き≠2G通常△+○斬り払い |
| `player.twin_blades.flurry` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 鬼人化中のみ乱舞 |
| `player.twin_blades.demon_on` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.demon_off` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.draw_cross` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.draw` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.twin_blades.sheathe` | [GUARD_AND_TWINS.md](GUARD_AND_TWINS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.smash` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.smash2` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.upswing` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.swing` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.charge` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.charge_smash` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.charge_upswing` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | PSPの溜め2は二接触 |
| `player.war_maul.pound` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.spin` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 途中の追加入力で終端が変わる |
| `player.war_maul.draw_smash` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | PSPの抜刀振り上げとの対応要検証 |
| `player.war_maul.draw` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.war_maul.sheathe` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.kesa` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.rise` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.thrust` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.back_cut` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.spirit1` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.spirit2` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.spirit3` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.round` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 後年の大回転は2G標準に含めない |
| `player.long_blade.draw_cut` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.draw` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_blade.sheathe` | [MAUL_AND_LONG_BLADE.md](MAUL_AND_LONG_BLADE.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.thrust1` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.thrust2` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.thrust3` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.high` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.guard_thrust` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.counter` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 2G標準に対応しないKari旧技 |
| `player.long_lance.counter_thrust` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 2G標準に対応しないKari旧技 |
| `player.long_lance.lunge` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | PSPの継続突進・停止・フィニッシュとは別 |
| `player.long_lance.hop` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.draw` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.long_lance.sheathe` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.ring_bow.shot` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.ring_bow.spread` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 散らし専用入力≠2G拡散矢射種 |
| `player.ring_bow.draw` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.ring_bow.sheathe` | [LANCE_AND_BOW.md](LANCE_AND_BOW.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.common.roll` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.item.drink` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.item.set_trap` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.item.throw_orb` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.common.carve` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.common.gather` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.common.mine` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.common.deliver` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
| `player.item.whet` | [COMMON_MOTIONS.md](COMMON_MOTIONS.md) | 入力／動作の一般説明。実際の姿勢は未観察 |
## 現行IDにまだ無い動作について

本表は既存の75行動を見落とさず照合するためのもので、原作2Gの全動作がKariへ実装済みという意味ではない。例：片手剣のガード中の2種類の攻撃、双剣の通常斬り払い、ハンマーの回転中の分岐、太刀の通常二段目の縦斬り、ランスの継続突進、弓のビン装着・近接・射線表示。新しいIDの採番と本体への統合はClaude側で確定する。

**必ず `README.md` の証拠区分を先に読むこと**。この資料はPSP実映像を観察した位置・足運び・肩回旋の記録ではない。
