# 設計済み機能の本体反映 — classic combat
2026-11-27 JST / main v0.60.0 / 65515084de558475659a7e419256637159207e7f
利用者の今回の「設計済みの項目で反映できるところは反映して」に従い、#29/#32と同様、通常のinbox限定の担当範囲をこの依頼に限り専用実装ブランチに拡張した。mainへ直接書き込まない・公開しない。Claudeとの合流前に検査する。

## 実際に変更したもの
- PR #30のintegration.patchを固定基準へ適用（全hunk照合）。成体12・幼体8の毒/麻痺/睡眠/気絶80設定、加算再発・上限・減衰・毒固定量。**#30の同じパッチを再度適用しない。**
- #19 03、#27 01の部位別属性肉質。20種・37部位の指定表、破壊後差分。絶対係数の0を許容、未指定は従来式。複合は採用した属性を命中演出へ渡す。ガルドロスの頭・訓練標的の比較値を保つ。生成器で上書きされないelements.jsonの調整表とし、種・部位・属性IDを検証。
- #27 03/05の拘束罠の相性。成体12種の通常/怒り/再発/最短時間、テンガロは怒り中に作動しない（解除後に同じ罠を使える）。永久免疫は現行種なし。設置は地面/岩/外周/段差/空中を調べ、消費確定前にも再判定。別エリア・上下に離れた敵・期限切れには発動しない。捕獲・所持数・罠の同時1個制限は保持。
- Vitest新規3ファイル（#30の9件、部位属性4件、罠6件）。既存のデータ/旧挙動も維持する検査を追加した。未実行。

## 根拠と判断
docs/classic-hunt.md v0.60.0、docs/chatgpt-board.md、#19の設計、#27の01_combat_math/03_monster_behavior、#30のパッチ・設計・現行20種の定義を照合。属性値と罠倍率はKari独自の初期値。原作数値の移植ではない。生態・器官の役割を参考にした仮設定で、実際の生理的根拠とはしない。採取#32、里#29、技能#31、追加武器#25、看板#28、受付#23は別作業として取り込んでいない。ゲームの機能がない技能や保存版変更を先行しない。

## 確認と未確認
verification.jsonの通り1289件の限定的なassertion成功（状態異常340、属性461、罠488）。変更後の純計算関数を限定的に型消去してV8で実行。型検査や全ゲームの実行ではない。コンテナからGitHubのDNS解決不可、npm依存導入・全Vitest・ビルド・smoke・iPhone未実施。19件の新規Vitestソースも未実行。罠の水域専用制限・複数種の罠・詳細な拒否理由UI、飛行/潜行の本体実装、物理/属性/状態蓄積の個別技係数、斬れ味などは今回の対象外。設計全体を満たしたとは扱わない。

## Claudeへの統合
最新mainと差分を照合し、#30が既に取り込まれている場合は重複を除く。#32等とsim.ts/validators.ts/schemaの挿入箇所を確認。データ調整表の正本は一つ。まず npm ci / npm run typecheck / npm run test -- tests/species-ailments.test.ts tests/part-elements.test.ts tests/trap-traits.test.ts tests/elements.test.ts tests/hunt-items.test.ts tests/classic-hunt.test.ts tests/determinism.test.ts、その後 npm run check / npm run smoke。実戦で罠の設置、怒り、属性演出、級別毒の実効性を確認。実機未確認の状態で公開合格にしない。

## 採集PR取り込み後の競合解消
mainが 5704d15256f0efda0e2448f9e20212969475cf12 に進んだため、基準 65515084de558475659a7e419256637159207e7f と実装先 2939510f07c81133f52338951596d2e658eafd63 との3方向比較を行った。schemas.ts/validators.tsは変更範囲が重ならず合成。sim.tsは2箇所のimportを統合し、採集のskillValue・usesFieldGather・FieldGatherState/FIELD_NODE_REACH、戦闘のweaponElementHit・罠関数を保持。採集側の変更はmainのtreeを正本として保持した。統合後の型検査・Vitest・実機は未実行。
