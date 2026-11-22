# Project
霧境の狩人 - VEILBOUND HUNTERS。横画面の三人称3D狩猟アクション。

# Source of truth
作業前に docs/spec.md、docs/animation-contract.md、docs/asset-manifest.json、docs/handoff.md を確認する。採用済み仕様を変更するときは理由と影響を docs/decisions.md へ記録する。
元の設計書は docs/source/VEILBOUND_HUNTERS_design_v1.0.pdf（49 ページ）。

# Architecture
TypeScript + Vite + Three.js。入力、simulation、render、data、save、UI を分離する。60Hz 固定 tick を戦闘の基準にする。描画 dt、描画補間、Math.random を戦闘判定の正本にしない。ゲーム内の AI API 呼出しを必須にしない。

- src/game/ は DOM・Three.js・現在時刻に触れない（Node のテストと将来のサーバーで同じコードを動かす）。
- src/render/ は simulation の状態を読むだけで、値を書き戻さない。

# Contracts
恒久 ID と表示名を分離する。モデルは m、Y-up、+Z forward。移動は controller を正本とする。clip、骨、socket を勝手に推測で置換しない。攻撃は startup、active、recovery、cancel、hitWindow をデータで管理する。ヒットは attackInstanceId + hitWindow.id + targetEntityId で重複防止する。

# Save
ゲーム固有の DB 名、schemaVersion、revision を持つ。報酬・生産は原子的に確定する。保存成功は transaction 完了後に表示する。旧版や未知 ID のデータを黙って消さない。JSON バックアップを提供する。
（M2 前半の時点でセーブは未実装。操作設定だけを localStorage の `veilbound-hunters:prod:settings` に保存している。）

# Browser
PC と横向き iPhone/iPad Safari を対象とする。複数指、safe area、回転、音声開始、非表示からの復帰を扱う。素材パスは Vite BASE_URL から解決する。通常の Safari タブで操作できることを優先する。

# Delivery
main へ push すると Actions（Build and publish）が gh-pages（配信元）を更新する。数分後に公開 URL で反映を確かめ、更新されていなければ `npm run publish:pages` で手元から更新する。
変更を小さく保ち、同じ範囲の受入条件を確認する。typecheck、test、build、assets:validate のコマンドを用意し、必要なものを実行する。未実行は未検証と記載する。仮素材・未実装・欠落を完成扱いにしない。README と handoff を更新し、動く版をタグで残す。

# Commands
- `npm run dev` 開発サーバー / `npm run build` 本番ビルド / `npm run preview` 本番ビルドの確認
- `npm run typecheck` 型検査 / `npm run test` 自動テスト / `npm run assets:validate` データと素材台帳の検査
- `npm run smoke` 本番ビルドをヘッドレス Chrome で操作する検査（Chrome が必要。`npm run build` の後に実行）
- `npm run check` typecheck + test + build
- `npm run publish:pages` 本番ビルドを gh-pages ブランチへ置く（コミット済みの状態で実行）
