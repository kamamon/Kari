# 疾棘竜スパインゲイル — クエスト統合 V1

ユーザー直接依頼（2G相当11武器種、初級〜上級、クエスト実装）。AGENTS.mdに従い、本体は直接変更せず提出フォルダへ置く。

## 収録
- source.zip: 実際の統合用ソース、データ、適用スクリプト、GLTFLoader描画アダプタ、軌道生成・検証ソース。SHA256 f7af84bd6f050be9e2ceedb1099b0981ec46ecebbd4dcadd759877d7f6e6b4f8。
- 全体パッケージ Kari_Spinegale_Quest_Integration_V1.zip（会話内の提供物）には上記ソース、171772三角形のGLB、軽量GLB、69透過PNG、採用原画を含む。GitHub側のsource.zipには大容量バイナリを含めていない。全体パッケージを展開して適用する。
- 23行動、13攻撃軌道、10移動曲線、23部位追従表。3クエスト、21素材、33武器、15防具、48レシピ、69アイコン。
- 既存の図鑑No.2セルヴァルクは変更しない。末尾に新規登録。初級はガルドロス討伐後、中級・上級は対応級と前級の狩猟後。極級は対象外。
- 現行mainは7武器系統。追加4系統（hunting_horn, gunlance, light_bowgun, heavy_bowgun）は11系統化の統合後に有効化する。

## 適用
全体ZIPを展開し、python validate.py → python apply.py <Kari root>（dry）→ python apply.py <Kari root> --apply → npm ci → npm run check → npm run smoke。ソースアンカーの変化時は停止し、現行コードに合わせて移植する。

## 確認と未完了
独立ファイル参照・PNG・GLBの77骨53クリップ・疲労600/540/480tick・素材抽選・レシピ参照を検査済み。ソースZIPをGit blob SHAで照合済み。コンテナからGitHub checkout不可のため本体適用、typecheck、test、build、smoke、狩猟完走、iPhone実機未確認。固定件数テストと既存の武器種拡張PR #39の整合も要確認。幼体群れ、武器防具専用3D外観、落ちた尾の描画、装備アイコン全画面確認は未完了。mainに変更なし。fal不使用。