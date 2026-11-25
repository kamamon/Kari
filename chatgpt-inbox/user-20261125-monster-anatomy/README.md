# モンスター解剖・79ノード骨格設計の実行引き継ぎ

利用者の直接依頼「現在のモンスターを実際にいる生物のような動きやパーツで動作するよう、スケルトンやデザインを詳細設計する」と、その設計への **「実行」** を受けた提出です。

**今回の確認基準:** Kari v0.26.0 / `1e078bfce1e68f287ae577cf41d2fe5bafb94afa`。前回の43ページ設計書はv0.22.0が基準です。読む順は **このREADME → 実行引き継ぎ → 最新差分監査 → 設計本文** としてください。

本PRは、利用者が実行を指示した設計を、Claudeが本体へ取り込むための資料です。`AGENTS.md`の分担に従い変更を`chatgpt-inbox/`内に収めています。正式GLBや79ノードの完成モデルを実装したPRではありません。

## 返したもの

| ファイル | 内容 |
| --- | --- |
| [EXECUTION_HANDOFF_v3.md](EXECUTION_HANDOFF_v3.md) | 今回実行する項目、順番、生成元・戦闘との契約、完了条件 |
| [current_status_v026.md](current_status_v026.md) | v0.25で実装済みの顎・接地・部位追従と、残る対象のソース監査 |
| [monster_anatomy_design_v2_recovered.md](monster_anatomy_design_v2_recovered.md) | 納品済み43ページPDFの全文。主要13種、幼体8種、骨格・接合・材質・動作・全86種台帳を保持 |
| [galdros_rig_blueprint_recovered_v3.json](galdros_rig_blueprint_recovered_v3.json) | PDF表から復旧した79ノードの名前・親・actor空間支点・旧番号・出典ページ。実行時データではない |
| [monster_production_matrix_v3.csv](monster_production_matrix_v3.csv) | 全86種。PDFの制作候補と最新登録簿のID・名前・frame・state・器官・外見・部位を照合 |
| [recovered_data_validation.json](recovered_data_validation.json) | 骨格構造・86種照合・65種の状態変更の検査記録 |
| [markdown_recovery_validation.json](markdown_recovery_validation.json) | 43ページの本文・表の復元で欠落・重複がないことの記録 |
| [validation_v3.json](validation_v3.json) | 本提出のnpm・ビルド・動作検査・提出範囲の結果 |
| [source_receipt.json](source_receipt.json) | 復旧元PDFのファイル名・SHA256・43ページ・基準版 |
| [archive/current_implementation_audit_v2.md](archive/current_implementation_audit_v2.md) | 前回v0.22.0監査の原文。現在の未実装一覧として使わない |
| [figures/](figures/) | PDFから復旧した技術模式図7枚（PNG） |

閲覧用の `Kari_Monster_Anatomy_Design_v2.pdf`（43ページ）は利用者へ納品済みです。本PRだけでも全文・表・7図を読めます。種別原画はリポジトリ内の既存PNGを参照しています。

## 現在地の読み替え

- 一般リグの独立顎と暗い口内面、四足・二足の通常歩行接地、一般19体の技中・睡眠中の被攻撃部位追従は **実装済み**。再発注しません。
- ガルドロスは現行53骨。79ノード案、正式GLB、局所軸・ウェイト、趾・翼の関節、ガルドロスの部位追従、転倒・怯み・切断後の追従は今後の対象です。
- 登録簿は最新では **implemented 20 / art 66**。旧PDFのplanned 65種は原画受領後にartへ変わっています。artは採用済みを意味しません。

## 守れなかった決まり・迷って決めたこと

- inbox限定・既存ID保持・main直接更新禁止を守りました。掲示板番号のない直接依頼なので `user-20261125-monster-anatomy` に分けています。
- 前回の転送は2文書で止まり、未送信の作業ファイルは残っていませんでした。保存済みPDFをSHA256で確認して全文・図・表を復旧し、旧監査はGitHubの既知blobと一致するものを使いました。
- 復旧した骨格JSONは、元JSONと同一ではありません。支点はPDFに印字された **0.001m精度**です。元の高精度座標や12socketの完全な定義を復旧したとは扱わず、制作前に現行ソースを正本として確認します。局所軸・bind matrix・ウェイトは前回時点でも未完成でした。
- 本体の技ID・判定時刻・威力・全長・原画の採用状態を、この提出で変更しません。利用者の「実行」はこの設計の実装引き継ぎとして記録し、別件の85原画の一括採用には広げません。

## 確かめたこと

- 最新AGENTS、掲示板、引き継ぎ、ガルドロスと一般リグ、部位追従・関連検査を確認。
- Node.js v24.22.3、`npm ci --no-audit --no-fund` 成功（50 packages）。
- `npm run build` 成功。既存の大きなchunkに関する警告あり。
- `npm exec vitest run tests/creature-motion.test.ts tests/follow.test.ts` 成功（2ファイル・15件）。`CREATURE_BAKE`は設定していません。
- 骨格79＝旧53＋追加26、名前一意、root一つ、親欠落・循環なし、全ノードがrootへ到達、尾8、岩板15。
- 全86種のID・番号・表示名をPDFと最新登録簿で照合。CSV再読込でframe・state・器官・外見・部位も照合。
- PDF全文43ページの復元で、全テキストspanを欠落・重複なく取り込んだことを検査。

## 確かめていないこと

新しい79ノードのモデル、ウェイト・補正形状・正式GLB、通常速度の全種映像、iPhoneの負荷と変形は未確認です。既存15件の成功は、新モデルの検収ではありません。骨格JSONはbestiaryインポート対象ではないので `bestiary:import --dry` の対象外です。

## Claudeへ

[EXECUTION_HANDOFF_v3.md](EXECUTION_HANDOFF_v3.md)のM1から進めてください。特に、旧骨番号を維持したまま新しい親を配列末尾へ足す場合、現行の「親が先に存在する」構築ループをそのまま使わないでください。全Boneの生成と親子接続を分け、基準姿勢と既存動作を維持してからウェイトを割り当てます。
