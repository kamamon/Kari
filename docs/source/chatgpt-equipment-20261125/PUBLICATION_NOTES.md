# 公開時追補 — v0.28.0 との整合確認

確認日: 2026-11-25

この追補は、全装備四級版の設計基準と、公開準備時点の実装の差分を説明する。装備の性能値、レシピ案、95枚の主原画は変更していない。**PDF・設計JSON・初版引き継ぎ文中の「現行」「未実装」「schema4」は、設計基準版の状態を指す。公開時点の実装状況は、この追補の記述を優先して読む。**

| 区分 | バージョン | 固定コミット |
| --- | --- | --- |
| 数値・原画・設計JSONの基準 | v0.26.0 | [`1e078bfce1e68f287ae577cf41d2fe5bafb94afa`](https://github.com/kamamon/Kari/tree/1e078bfce1e68f287ae577cf41d2fe5bafb94afa) |
| 公開準備時に確認した実装 | v0.28.0 | [`3987f38387fc337c5b1f354f99c1208864837fda`](https://github.com/kamamon/Kari/tree/3987f38387fc337c5b1f354f99c1208864837fda) |

## 1. 武器・防具・既存レシピの基準は維持

両コミットの次の3ファイルをバイト単位で比較し、内容が完全一致することを確認した。既存武器の攻撃力・会心・属性欄、防具の防御力、レシピの必要素材・個数・費用・前装備・生成先を含め、この間の変更はない。

| ファイル | 収録件数 | 比較結果 |
| --- | ---: | --- |
| [`public/data/weapons.json`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/public/data/weapons.json) | 武器35件 | 完全一致 |
| [`public/data/armor.json`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/public/data/armor.json) | 防具25件 | 完全一致 |
| [`public/data/recipes.json`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/public/data/recipes.json) | 強化レシピ48件 | 完全一致 |

したがって、本提案の計算に使った既存ガルドロス装備と48レシピの基準を維持する。3,000装備候補・3,000レシピの提案を、v0.28.0 で採用・ゲーム内実装したという意味ではない。`data/all-equipment.json` の `runtimeImportable: false` は引き続き有効であり、ゲーム用JSONへそのまま読み込まない。

## 2. 採集・採掘の4素材と5依頼は実装済み

v0.27.0 で風礫盆地の基礎的な採集・採掘・現地納品が追加され、v0.28.0 にも収録されている。現在の素材IDと、実際に入手できる依頼・場所は次のとおり。根拠は現行の [`items.json`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/public/data/items.json)、[`quests_errands.json`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/public/data/quests_errands.json)、および [`docs/spec.md` 第27章](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/docs/spec.md) を参照する。

| 素材 | 恒久ID | 実装済みの入手経路 |
| --- | --- | --- |
| ヒラナギの葉 | `mat.gather.flatnagi_leaf` | G01 または D01 の野営地（`camp`）で採集 |
| ツユワリの実 | `mat.gather.dewbreak_fruit` | G02 の野営地（`camp`）で採集 |
| 風礫鉄鉱 | `mat.ore.basin_iron` | M01 のエリア1「礫の坂」（`a1`）で採掘 |
| 礫目砥石原石 | `mat.ore.grit_whetstone` | M02 または D01 のエリア5「涸れ沢」（`a5`）で採掘 |

| 依頼・恒久ID | 達成に必要な現地納品 | 採取点 | 報酬通貨 |
| --- | --- | --- | ---: |
| G01「薬房へ、最初の六枚」<br>`quest.gather.001` | ヒラナギの葉6枚 | 野営地4か所 | 240 |
| G02「炊事場の空いた籠」<br>`quest.gather.002` | ツユワリの実8個 | 野営地5か所 | 280 |
| M01「炉の火をつなぐ石」<br>`quest.mine.001` | 風礫鉄鉱6個 | 礫の坂4か所 | 280 |
| M02「刃を整えるざら石」<br>`quest.mine.002` | 礫目砥石原石6個 | 涸れ沢4か所 | 300 |
| D01「薬房と工具棚の小包」<br>`quest.delivery.001` | ヒラナギの葉4枚＋礫目砥石原石4個 | 野営地3か所＋涸れ沢3か所 | 300 |

5件とも `kind: gather`、`fieldId: field.basin`、`rankId: rank.1` の★1依頼で、フィールドから最初から受注できる。制限時間は15分、大型・幼体の出現はない。採掘依頼でもクエストの `kind` は `gather` であり、採取点の `kind: mine` で採掘動作を区別している。

採取点1か所につき2個を確実に取得し、1回の出発で各点を使えるのは1度だけ。エリアを出入りしても復活しない。納刀して採取点の近くで攻撃ボタンを使う。納品に数えるのはその出発の採集袋の中身だけで、倉庫の在庫や支給品は使わない。必要数を野営地の納品箱へ一括納品して達成すると、**納品で消費した分を除く余りだけ**が通常の所持素材として持ち帰られる。全採取点で採れば、各要求素材につき2個ずつ余る。失敗・リタイアでは採った素材と依頼報酬を持ち帰らない。現行処理は [`src/game/errand.ts`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/src/game/errand.ts) と [`src/game/sim.ts`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/src/game/sim.ts) を参照する。

**この4素材は採取・持ち帰りまで実装済みだが、調合・装備生産・強化への用途と商店売買はまだ実装されていない。** 風礫鉄鉱を持っているだけで風礫鍛鉄装備を作れるわけではなく、ガルドロス素材を天然鉱石で代用する処理もない。

## 3. 設計スナップショットの実装フラグの読み方

設計JSONの `sourceCommit` は引き続き v0.26.0 の固定コミットである。`isImplemented`、`recipeImplemented`、素材の「未実装」注記はその時点の記録として保存しており、最新の実行時データから再生成していない。

今回の装備資料に現れる実装済み素材は、上記4素材のうち **`mat.ore.basin_iron`（風礫鉄鉱）だけ**である。これは G04／No.90「風礫鍛鉄」（`gathering.forged_iron`）初級の主材であり、`data/gathering-series.json` の `materialChain`、`data/all-equipment.json` の系列側 `materialChain` と素材側の記録・`sourceRecord` にある `isImplemented: false` は旧版の状態を示す。現在は第2節の M01 で入手できる。これに対し、同じ `sourceRecord` の `recipeImplemented: false` は現行でも該当する。

ヒラナギの葉・ツユワリの実・礫目砥石原石の3素材は、本提案の `data/all-equipment.json` の装備素材表には含まれていない。今回の追補によって素材583行や装備3,000候補の件数へ追加したり、既存レシピの素材を置換したりしない。

基礎4素材の実装を、採集12種・鉱石12種すべての実装と読み替えない。虫取り、今回提案した虫素材、高級の採取点・加工、他地域の採集・採掘、各新系列の装備生産・技能などは引き続き設計候補である。風礫鍛鉄の初級主材が入手できるようになっても、その支持材、後続級の素材、装備生産レシピが揃ったとは扱わない。

## 4. 保存データは schema5 を基準にする

v0.28.0 ではキャラクターメイクの外見 `appearance` が加わり、`SAVE_SCHEMA_VERSION` は **5** になっている。初版 `CLAUDE_HANDOFF.md` 第7節の「現行保存schema4から」は、今後実装する場合には **「現行保存schema5から、必要な追加フィールドを版管理する」** と読み替える。根拠は [`src/save/profile.ts`](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/src/save/profile.ts) と [`docs/spec.md` 第28章](https://github.com/kamamon/Kari/blob/3987f38387fc337c5b1f354f99c1208864837fda/docs/spec.md) を参照する。

既存の schema4 → 5 の移行は、`appearance` がない保存データへ `legacyAppearance()` による「基準ハンターA」を補う。近似色や全軸50へ置き換えない。外見は能力値に関与せず、未知の外見欄・IDは保持し、表示時だけ基準ハンターAへ代替する。

今後装備を実装するときは、この移行を巻き戻したり schema4 を再利用したりせず、既存の外見・所持素材・通貨・装備中のID・進行・受け取り記録を維持する。新たに保存構造の変更が必要になった場合に限り、現行の1段ずつの移行方式へ次の移行を追加する。本資料の公開そのものによる保存データの変更はない。

## 5. この確認の範囲

本追補は固定コミット間のソース・データ比較と現行仕様の確認であり、追加装備をゲームへ導入した記録ではない。性能値・素材個数・費用・技能案・原画は設計基準版を維持しており、実戦バランス、全級の原画、iPhone操作、採用後の保存移行を新たに検証したという意味でもない。採用時には本追補の入手実装と schema5 を出発点に、初版引き継ぎの実装・検証手順を適用する。

## 6. 公開パッケージと検証記録

公開パッケージは255ファイルで、95枚の主原画PNG、修正履歴として残す6枚の旧版PNG、表示補修と図版圧縮を行った公開閲覧版PDF、完全JSONとそのgzip版、設計元JSON、プロンプト、規則、監査記録、再出力用ツールを収録する。重複する配布ZIP、PDF用の埋め込みHTML、初期草案・中間出力は含めない。PDFの変更範囲と検証は第7節を参照する。

一時作業環境の絶対パスは公開用に整理した。原典画像への参照はリポジトリ直下からの相対パス、採用した装備原画の `artFile` は本資料ディレクトリからの相対パスである。`sourceGeneratedFile`、`generatedImagePath`、`generatedSource`、`finalSourcePath` などは生成時のファイル名だけを残しており、公開ファイルへのリンクではない。実際の公開原画は [data/art-manifest.json](data/art-manifest.json) で照合する。`analysis/book-validation.json` の `generatedFiles` は初版生成時の出力履歴であり、そこに記載するHTMLは公開パッケージに含めない。この初版監査と `analysis/final-pdf-structure.json` は第12ページの表示欠落が判明する前の記録なので、公開PDFの完全性・ハッシュの証明には第7節の検査記録を使う。

パス整理によって完全JSONのSHA256は変わるが、初版の [independent-audit.json](analysis/independent-audit.json) にある監査対象SHA256を現在値で上書きしていない。元の監査SHA256、公開JSONのSHA256、アート情報を除く数値指紋の一致、PNGのバイト一致、公開PDFの補修・圧縮結果を [publication-validation.json](analysis/publication-validation.json) に記録する。完全JSONの `sourceCommit`、実装フラグ、性能値、素材数、費用、生成先、原画そのものは維持する。公開PDFは元PDFと同じバイト列ではない。

[package-validation.json](analysis/package-validation.json) の `externalRepositoryPublished: false` は初版作成時の記録である。同ファイルの `publicRepositorySubmission` は、利用者の明示承認に基づき公開PRへ提出するために整えた今回の状態を表す。公開・マージの結果を先取りするフラグではない。

全公開ファイルのSHA256は [SHA256SUMS](SHA256SUMS) に記載する。このディレクトリで `sha256sum -c SHA256SUMS` を実行して確認できる。公開255ファイルのうち、検証記録を含む254ファイルが対象で、自己参照を避けるため `SHA256SUMS` 自身だけを除外する。

## 7. 公開PDFの表示補修と図版圧縮

元PDF約27.9MBを1回で送る処理が転送エラーになったため、公開閲覧版を用意した。最終視認で第12ページのガルドロス素材表に上級・極級の行が表示されていないことも確認したので、**表示補修を行ってから図版を圧縮した**。この2工程で数値JSONや原画PNGは変更していない。

| 段階 | バイト数 | SHA256 |
| --- | ---: | --- |
| 初版監査の元PDF（履歴） | 27,878,891 | `82c10ea23e26f7fed957a05e19887cc19ee7eb57a1c341ae26cec72be79b2487` |
| 第12ページを補修した中間PDF（履歴） | 28,227,351 | `dee6da5a0951824126d22902397caecfc28612130f05b1caa61adc28284ed6f0` |
| 公開閲覧版 `Kari_All_Equipment_v2.pdf` | 12,047,197 | `ae231cec0f826c649769541268d5c3719843f9a23f7aae82d83014d217a91d3c` |

**表示補修:** ガルドロスの数値・素材数・費用はJSONに揃っていた。多数素材の表だけ素材名の表記と表余白をコンパクトにし、第12ページに四級すべての素材行を表示した。全250系列級の素材行、ガルドロス48レシピの必要数を検査し、他199ページの本文・文字座標と全102リンクは元PDFから変わっていない。根拠は [pdf-recipe-repair-validation.json](analysis/pdf-recipe-repair-validation.json)、再現処理は [repair_catalog_recipe_page.py](tools/repair_catalog_recipe_page.py) を参照する。

**図版圧縮:** 補修済みPDFの図版96枚（95系列と表紙）だけをJPEG quality 65・4:2:0で再圧縮した。画像の縦横寸法は維持し、縮小していない。補修済みPDFから公開閲覧版への比較では、全200ページの本文・文字座標・ページ寸法・画像寸法と配置・全102リンクが一致し、メタデータと目次構造も維持した。根拠は [pdf-publication-validation.json](analysis/pdf-publication-validation.json)、再現処理は [optimize_public_pdf.py](tools/optimize_public_pdf.py) を参照する。

図版には非可逆圧縮による画質の変化がある。原画の細部は、元のバイト列を維持した95枚の主PNGと6枚の履歴PNGで確認する。公開閲覧版の視認対象は第11・12・181・199ページの4ページで、その [確認画像](analysis/pdf-publication-contact.jpg) を収録した。全200ページに対する確認は上記の構造・本文・配置・リンク比較であり、公開閲覧版を全ページあらためて目視確認したという意味ではない。
