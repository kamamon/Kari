# 依頼011：提出版の検証記録（2026-11-26）

## 合格した範囲

- GitHubのリポジトリ `kamamon/Kari` のPR #21の前版（`afd15a624ae593fea70ed1c67b9b9291d131af25`）に含まれる**130 JSONを、GitHubのblob APIから実際に130件すべて読み直してJSON.parse**した。
- 130件とも `kariActionId`、`observed2gMove`、`source`、`startState`、`weaponPath`、`rootMotion`、`contactEvents`、`differencesFromKari`、`unknowns` がある。
- 130件とも `K0`、`K1`、`K2`（または `K2a...`）、`K3`、`K4` の存在を確認。各キーに `support`、`feet.L/R`、`pelvis`、`chest`、`weapon` がある。**確認したチェック項目で不備0**。
- 追補として、2G文献に照らして既存9件の `observed2gMove`／`differencesFromKari` を修正。`controlEvidence` に出典URLと「映像計測でない」フラグを追加した。27の提案新技は `proposedActionId` を使い、既存 `player.*` と区別した。
- 本追補により変更する9件のGit blob SHAを含め、`INDEX.json` を現在のファイルに合わせて作り直す。検査器は一致が崩れたら失敗する。

## 実行・検証の限界

- Node.jsの同梱コード `qa/validate-evidence.mjs` と従来の `qa/validate-observations.mjs` は、提出の環境にGitHub上の全ファイルをローカル展開できておらず、**実際の端末での実行は未確認**。GitHub APIから取り出したJSONの直接チェックだけを実行した。
- 既存資料の `plannedKariTick` はゲームの現行tickであり原作フレーム数ではない。K0〜K4の角度・足の位置はKari独自の暫定値。
- 元のMHP2G連続プレイ映像を直接フレームごとに再生・観察できていない。映像中の技別の開始・接触・終了と手足の動きは**未検証**。チャプターの時刻は技の時刻ではない。
- `npm ci`、ゲームの型チェック、アニメーションの生成、WebGL実機、iPhone操作、当たり判定・カメラ・FPS測定は**未実施**。コード・アセット・モデル・セーブの変更なし。

## Claude向け受け入れゲート（次工程）

1. 本PRは`chatgpt-inbox/011/`以外のファイルを変更していないこと。
2. リポジトリルートで `node chatgpt-inbox/011/qa/validate-evidence.mjs` を実行して索引・根拠・130+27を検査。
3. PSP日本版2Gの連続録画を0.25倍・コマ送りで確認し、**原作の観測姿勢を別に付録**。入力・技・時刻を一致させてから元の暫定値へ反映する。
4. 既存動作切替と新クラシック動作を並立。クライアントとsim両方の`1/60s`時刻を一致させ、手と武器の握り離れ、床貫通、滑り、ヒット窓、被弾中断、道具確定、弓発射を全tick検査する。
5. WebGL／iPhone実機と通常速度の狩猟を確認して初めて`integrated`へ進める。

この報告の「構造合格」を「2Gモーションの再現合格」に読み替えないこと。
