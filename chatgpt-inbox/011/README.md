# 依頼011 — PSP版2Gを基準にしたハンターモーション観察・制作票（第1提出）

**対応リポジトリ:** `kamamon/Kari`。掲示板 `docs/chatgpt-board.md` の依頼11（v0.55.0）。
**作業根拠:** `docs/chatgpt-request-11.txt`、`docs/animation-contract.md`、Kariの全7武器の現行アクションJSON、`src/render/poses.ts`・`heavyBodyMotion.ts`、Capcom PSP用資料、PSP日本版の訓練プレイ動画の章一覧。
**提出場所:** このフォルダのみ。本体 `src/`・`public/`、`docs/` は変更しない。

## まず重要な注意

ここに含まれる**130件は原作モーションの実測を完了した「完成観察票」ではない。** 動画の説明欄からPSP日本版の各武器の訓練章の時間範囲は確認できたが、動画そのもののコマを取得・確認する手段が無く、各技のK0〜K4の関節角、支持足、時刻を原作から実測できなかった。Capcom公式のMHFUガイドとPSPの攻略資料から**武器と技の大まかな構成**は確認した。したがって、数値欄はすべて `valueBasis` に明記した**Kari専用の暫定制作値**である。原作に関する未測定値は `time:"未測定"` と `unknowns` に残した。

**原作のデータやモーションを抽出していない。原作動画、画面写真、原作モデル、原作の攻撃力数値もリポジトリには入れていない。** 使用したものは参考URL・章の区間・文献で確認した操作構成・Kari用の独自の図と数値だけ。動画の章の時刻を、技の攻撃発生や動作尺と誤解しないこと。

## 今回納品した構成

- **実体130件のJSON**。トップレベルに1動作1ファイル。すべて `kariActionId`、`observed2gMove`、`source`、`startState`、`keys`、`weaponPath`、`rootMotion`、`contactEvents`、`differencesFromKari`、`unknowns` を持つ。
- 現行の **全7武器の攻撃行動（49件）**、全7武器の構え・抜刀歩行・draw・sheathe、共通の納刀歩き・走り・疾走、共通の道具・剥ぎ取り・採集・採掘・納品、ガード・回避・被弾・登攀。
- `K0` 開始、`K1` 予備、`K2` 接触・射出・効果、`K3` 終端、`K4` 復帰。複数の命中時刻が異なる技は `K2a`・`K2b` 等を追加し、Kari現行tickを `plannedKariTick` に記した。**これも原作のtickではない**。同tickの左右刃は1キー内の別判定として説明する。
- `src/render/...#...` と名付けた票は **action IDではなく描画状態／制作上の場所**。現行JSONに存在しないaction IDを捏造せず、`idKind` または `kariReference.rendererState` で区別する。
- 技の全体の資料と保留事項: `SOURCES_AND_GAPS.md`。検査: `qa/validate-observations.mjs`。
- 独自の棒人間ベクター図 `diagrams/heavy_blade_overhead_K0-K4.svg` は **Kari向けキー構成の模式図**。PSP画面やトレース画像ではない。依頼の望ましいPNGにはしていない。

## 2G互換を妨げる既存ID

- `player.long_blade.helm`: 原作2Gでは見本にしない兜割り。今は旧IDを保護して観察票に移行理由を記載。削除または対応する気刃連係への移行をClaudeに依頼する。
- `player.long_lance.counter` / `counter_thrust`: 2Gのランス標準ではない。受け返しとして無理に扱わず、別の正規動作を作る。
- `player.ring_bow.spread`: Kariの散らしを2Gの矢種へ断定的に対応させない。射種・近接・ビン装着を別行動として設計し直す。
- **未存在の予定動作:** 太刀の `spirit1〜3` と `round`、弓のビン付け／近接、片手剣のガード中の道具、回避の方向専用actionなど。これらには現行action IDが無いため `player.*` を新設して完成扱いにせず `SOURCES_AND_GAPS.md` に列挙。Claude側でID・状態契約を確定後に追補する。

## Claudeの取り込み順

1. `SOURCES_AND_GAPS.md` のエビデンス区分を確認し、「観察済み」と「Kari制作仮案」を混同しない。
2. `node chatgpt-inbox/011/qa/validate-observations.mjs`（Node22以上）を実行。構造と現行action IDの一致を確認する。
3. **実際のPSP日本版2Gの連続プレイ映像**で各技ごとの時刻を特定し、K0〜K4を正面／横から目視で取り直す。その時だけ `source.from/to` を章の区間から技単位の区間に置換し、原作の実測値を追加する。未視聴のまま2G準拠の姿勢として承認しない。
4. 既存Kariの行動を `classic_hunt_v1` と旧版の切り替えで残し、骨と武器の大きさ・判定はKari規格のまま、新しい姿勢と足の接触を制作。GLB・モーション完成の宣言は別途実機とゲーム内検証後。
5. K0〜K4と `plannedKariTick` の差を吸収しつつ、武器の軌道・当たり・ヒットストップ・姿勢の同期を検査する。3Dソースを直接置き換えるのはClaude担当。

## 確かめたこと

- 掲示板・依頼文・Kariの全7武器のaction JSON、関連規格を最新main v0.55.0で確認。
- 現行の攻撃・draw・sheathe IDをもとに票を生成し、JSONの必須キー・K0/K1/K2/K3/K4・左右足・骨盤・胸・武器位置の有無を生成時に確認。
- 生成したGitHubツリーの `011/` 直下に**重複なし130 JSON**があることをAPIで照合。
- 実行検査用スクリプトも同梱。ただしGitHub上の全ファイルをローカルに展開した `npm ci` と `node qa/validate-observations.mjs` は、この提出時点では未実行。本体への統合・WebGL・iPhone実機での操作と見た目も未確認。

## 守れなかった決まり・迷って決めたこと・確かめていないこと

- **守れなかった決まり:** 原作の連続動画を直接見てK0〜K4を測ることができていない。原画のPNGも作っていない。原作の観察値と見せかけず、全数値をKari仮値として開示した。
- **迷って決めたこと:** 現行 action ID を消さず、2Gにない旧技も明示的に「移行・廃止候補」の票を残した。存在しない共通動作は `src/render/...#...` を仮の識別子として利用した。コンボの実測時間を勝手に作らなかった。
- **確かめていないこと:** 原作映像の姿勢、打点、時刻、支持脚、足の順、掌と柄の向き、Kari新姿勢のIK・接地・全装備でのクリッピング・攻撃バランス。現時点では「実測済み2G観察票」として本体への採用判定はできない。


## 追補（2026-11-26）：2Gの操作仕様確認・対象の欠けを補う

- [2G_CONTROL_EVIDENCE.md](2G_CONTROL_EVIDENCE.md) — PSP版2Gの七系統に関して公開されている**操作・技の連係**を資料別に照合。大剣の○は「薙ぎ払い」であり「横殴り」との混用を取り消した。太刀の気刃連係、ランスの継続突進とその停止、弓の射種とビン装着を切り分けた。
- [2G_MISSING_ACTIONS.json](2G_MISSING_ACTIONS.json) — 現行130件以外に必要となる**提案27動作**の仕様。まだKariに存在しないため `proposedActionId` として分離し、原作動画の実測姿勢・時間は「不明」「未測定」にした。これらを既存行動として読み込まないこと。
- 文献に基づいて対応を修正した既存票9件（`heavy_blade.side_sweep`、`guard_blade.bash` / `guard_slash`、`twin_blades.stab` / `flurry`、`war_maul.charge_upswing`、`long_blade.helm`、`long_lance.lunge`、`ring_bow.spread`）。`controlEvidence` は**文書の操作確認であって映像の姿勢測定ではない**。
- [qa/validate-evidence.mjs](qa/validate-evidence.mjs) — 130件・27提案・Git blob索引・根拠フラグをまとめて検査する読み取り専用の検査器。
- [qa/FINAL_VERIFICATION.md](qa/FINAL_VERIFICATION.md) — GitHubから元の130 JSONを**全件再取得・JSON構文とK0〜K4の重要構造を検査し欠落0**を確認。新規9件と27提案の検証の範囲も記録。

**残る受け入れ障害は、PSP版2Gの連続映像の実際のコマを見てキー姿勢を採寸すること、ゲームへアニメーション実装し実機で確認すること。** 現状は文献確認済みの操作規格＋Kari用の暫定動作仕様であり、原作の動画実測を終えたものではない。公開動画のチャプター時刻は、映像中の技の時刻を代用しない。
