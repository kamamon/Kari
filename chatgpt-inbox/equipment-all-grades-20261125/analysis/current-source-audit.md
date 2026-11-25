# 全モンスター・採集装備の現行ソース監査

監査日: 2026-11-25 JST。固定基点: `1e078bfce1e68f287ae577cf41d2fe5bafb94afa`、contentVersion 0.26.0。
担当は読み取り・監査のみ。新しい装備、素材、級別解放はまだ書き込んでいない。
詳細機械可読データは `current-source-audit.json`。

## 1. 四つの級と五段階の装備は別

| 現行の級 | 恒久ID | 対応するガルドロス装備段 | 防具一式 | 個体HP / 部位 / 攻撃 / 技間隔 |
| --- | --- | --- | ---: | --- |
| 初級 | rank.1 | T2 岩殻 | 30 | 1 / 1 / 1 / 1 |
| 中級 | rank.2 | T3 脈殻 | 65 | 1.35 / 1.35 / 1.30 / 0.90 |
| 上級 | rank.3 | T4 晶殻 | 105 | 1.80 / 1.80 / 1.65 / 0.80 |
| 極級 | rank.4 | T5 輝殻 | 150 | 2.40 / 2.40 / 2.05 / 0.70 |

T1は里鍛ち／里装束で、四つの級の前にある初期装備。防具一式0。
武器は7系統×5段=35、全て現行の無属性・会心0を維持。
防具は5部位×5段=25、各部位0 / 6 / 13 / 21 / 30。
recipes.jsonは48の元装備置換強化。直接生産はまだない。

根拠:
- [ranks.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/ranks.json)
- [spec.md 第17章](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/spec.md)
- [weapons.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/weapons.json)
- [armor.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/armor.json)
- [profile.ts](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/save/profile.ts)

## 2. 昇級と星数

実装済みのガルドロス依頼は、`quest.basin.003` → `quest.basin.r2.001` → `quest.basin.r3.001` → `quest.basin.r4.001`。
requires配列で先行依頼の達成を確認する。独立したハンター級の変数から全依頼を一括解放する構造ではない。
新しい「5候補から異なる2件＋昇級確認」案はsourceフォルダの将来提案であり、現行実装ではない。
星は適正装備の狩人にとっての難易度表示で、星からrankIdを変えない。
目安は初級★1〜2、中級★3〜4、上級★5〜6、極級★7〜8。
採集依頼の★1だから初級などと機械変換しない。

根拠: `public/data/quests.json`、`docs/spec.md`第26章、`docs/source/chatgpt-quest-design-20261125/progression_v1.json`。

## 3. 全86種の対象範囲

| 元の初登場級 | 種数 | 図鑑番号 |
| --- | ---: | --- |
| 初級 | 21 | 01〜21（大型13＋幼体8） |
| 中級 | 20 | 22〜41 |
| 上級 | 25 | 42〜66 |
| 極級 | 20 | 67〜86 |

class別はlarge68、juvenile8、huge10。実装状態はimplemented20（大型12＋幼体8）とart66。
ガルドロスだけは初級〜極級の素材表がある。その他の実装大型11種と幼体8種は初級依頼と素材のみ。
エンバルグ以降の66種は図鑑と原画があるが、戦闘・素材ドロップ・レシピの完成を意味しない。

元の初登場級を守って上位強化を作る場合、級別の系列数は21 / 41 / 66 / 86で、計214系列×級。
全7武器＋全5防具なら1498武器＋1070防具=2568候補。
86種を無条件に4級へ展開すると344系列×級となり、高級種を初級へ下げる新方針なので明記が必要。
今回ユーザーは「全モンスター」と明示しているため、前回の幼体は補助素材だけという方針は固定条件として継承しない。幼体の全装備化・上位素材は新提案と明記する。

**表示名と恒久IDの違いを保持**:
- No.57 テムソギア = `monster.tarhegna`
- No.71 セオルミド = `monster.segranio`

根拠: [bestiary.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/bestiary.json)。

## 4. 採集・採掘・虫取り素材

現行の通常素材は77種（items.json 10＋items_creatures.json 67）。自然採集・鉱石・虫素材はこの77種にはない。
既存クエスト設計案 resources_v2.json に採集12種、鉱物12種、貸与貨物4種がある。全28新定義は未実装と明記。
虫素材は既存案にもないので、名称・ID・採取方法・生息地・級別解放を今回新設する必要がある。
非狩猟クエスト案の素材にはrankIdが付いていない。狩場と物語到達を条件にする案で、星数とは別。

装備の基礎素材として引き継ぎやすい既存案:
- `mat.gather.threadbind_fiber` スジユイの繊維（盆地）
- `mat.gather.rootmesh_bundle` ネアミ根（湿原）
- `mat.gather.shoreseam_algae` ハマトジ藻（海岸）
- `mat.gather.whiteline_moss` シロスジ苔（氷帆峡谷）
- `mat.gather.slimlight_resin` ホソアカリ樹脂（霧灯樹海）
- `mat.ore.basin_iron` 風礫鉄鉱（盆地）
- `mat.ore.tide_copper_ore` 潮青鉱石（海岸）
- `mat.ore.bell_mine_firestone` 灰鐘耐火石（鉱山）
- `mat.ore.dull_crystal_mica` 鈍晶雲母（鉱山）
- `mat.ore.icebank_hardstone` 氷縁硬石（氷帆峡谷）

ただし元提案では用途が施設補修や生活道具中心で、「装備レシピは別途」とされている。今回装備へ使うことを新設計として明示する。
貨物4種は通常倉庫へ入らず、素材に転用しない。
自然の潮青鉱石とガルドロスの青銅晶脈、自然の冷たい石とキリサーヴの冷晶は別物。採掘で生物素材を得られる扱いにしない。

根拠: [resources_v2.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/source/chatgpt-quest-design-20261125/resources_v2.json)、[nonhunt_catalog_v2.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/source/chatgpt-quest-design-20261125/nonhunt_catalog_v2.json)。

## 5. 実装に渡す際の境界

- 現行の狩場実装は風礫盆地1つ。図鑑上の狩場案は20。別狩場でしか得られない素材にはコンテンツ準備条件が要る。
- 採集点、採取動作、採集袋、野営地の納品箱、虫取りは未実装。掲示板は盆地のG01・M01を次版予定とする。
- 里の納品D09とT2素材の工房支給はv0.26.0で実装された。これを採集・採掘の実装と混同しない。
- 保存schemaは現行4。前回設計で前提にしたschema3は古い。素材・装備の恒久IDはそのまま保持する。
- 機能、本体データ、実行コードは変更しない。提案をchatgpt-inboxに置いてClaudeへ引き継ぐ。
- 画像は制作資料。全86種の原画はmainにあるが採用・四方向図・3D化は別工程。
- 実行確認は今回の読み取り監査には適用しない。新しい設計JSONをモンスター取込機能へ渡さない。

根拠: [chatgpt-board.md](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/chatgpt-board.md)、[AGENTS.md](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/AGENTS.md)、[content.json](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/content.json)。

## 6. 監査中の補足

前回の作業ディレクトリは残っておらず、前回PDF・データ・画像をローカルから再利用できる状態ではなかった。
今回の監査は最新固定SHAから読み直した。元ソース変更0、外部投稿0、画像生成0。
数値のプレイ検証や新規装備の採用判定は行っていない。
