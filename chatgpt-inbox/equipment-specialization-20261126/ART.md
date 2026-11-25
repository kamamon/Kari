# 全86種の装備比較原画

**22枚で全86種を1回ずつ収録。各種の初登場級の成人用防具と、代表武器2系統を描いた比較原画です。** 防具は頭・胴・腕・腰・脚の5領域、代表武器は合計172系統です。護刃の剣と盾、長尖槍の槍と盾、双剣の2本は、それぞれ1系統として数えます。

この画像は、失われた前回の作業画像をバイト単位で回収したものではなく、今回の再構築仕様から新しく生成し、目視で修正・確認した原画です。全7武器と各級の形状仕様は [data/species](data/species/) にあります。全7武器・全級の専用画像、正投影図、完成3Dモデルではありません。

## 原寸PNGを復元して確認する

リポジトリには、PNG原本22枚の全バイトを [art/packed](art/packed/) の分割片として収録しています。大きい画像の転送が停止したため、1片を最大262,140 bytesに分けました。再圧縮や画素変更は行っていません。合計59,570,121 bytes、236片です。対応・順序・SHA256・Git SHAは [packed-index.json](art/packed-index.json) にあります。

リポジトリのルートで次を実行します。Python 3の標準ライブラリだけで動き、追加インストールもネット接続も不要です。

```bash
python3 chatgpt-inbox/equipment-specialization-20261126/reference/materialize_art.py
python3 chatgpt-inbox/equipment-specialization-20261126/reference/validate_art.py
```

1つ目は各片と結合後のSHA256を検査して、`art/board-01.png`～`art/board-22.png` を原寸のまま復元します。同じ場所に異なるPNGがある場合は上書きせず停止します。2つ目はPNGを変更せず、全片・全PNGのサイズとSHA256、IHDRの寸法、全86種の重複なし対応、代表172系統、プロンプトの存在を検査し、[art-validation.json](analysis/art-validation.json) に結果を書きます。

下表の「原データ」はGitHub上で存在する分割片の場所です。PNGのファイル名は復元後の保存先を示します。

## 22枚の目録

| ボード／復元後ファイル | 種番号 | 寸法（px） | 原寸bytes | 分割片 | 目視記録 |
|---|---|---:|---:|---:|---|
| 01 / `art/board-01.png` | 001–004 | 1774 × 887 | 2,846,834 | [11片](art/packed/board-01/) | [所見・制作差分](art/manifest-01.json) |
| 02 / `art/board-02.png` | 005–008 | 1774 × 887 | 2,976,014 | [12片](art/packed/board-02/) | [所見・制作差分](art/manifest-02-07.json) |
| 03 / `art/board-03.png` | 009–012 | 1774 × 887 | 2,313,653 | [9片](art/packed/board-03/) | [所見・制作差分](art/manifest-02-07.json) |
| 04 / `art/board-04.png` | 013–016 | 1536 × 1024 | 2,883,319 | [11片](art/packed/board-04/) | [所見・制作差分](art/manifest-02-07.json) |
| 05 / `art/board-05.png` | 017–020 | 1672 × 941 | 2,348,121 | [9片](art/packed/board-05/) | [所見・制作差分](art/manifest-02-07.json) |
| 06 / `art/board-06.png` | 021–024 | 1774 × 887 | 2,524,435 | [10片](art/packed/board-06/) | [所見・制作差分](art/manifest-02-07.json) |
| 07 / `art/board-07.png` | 025–028 | 1774 × 887 | 2,489,987 | [10片](art/packed/board-07/) | [所見・制作差分](art/manifest-02-07.json) |
| 08 / `art/board-08.png` | 029–032 | 1774 × 887 | 2,936,606 | [12片](art/packed/board-08/) | [所見・制作差分](art/manifest-08-14.json) |
| 09 / `art/board-09.png` | 033–036 | 1752 × 897 | 2,956,891 | [12片](art/packed/board-09/) | [所見・制作差分](art/manifest-08-14.json) |
| 10 / `art/board-10.png` | 037–040 | 1774 × 887 | 2,883,474 | [11片](art/packed/board-10/) | [所見・制作差分](art/manifest-08-14.json) |
| 11 / `art/board-11.png` | 041–044 | 1774 × 887 | 2,436,403 | [10片](art/packed/board-11/) | [所見・制作差分](art/manifest-08-14.json) |
| 12 / `art/board-12.png` | 045–048 | 1774 × 887 | 2,949,394 | [12片](art/packed/board-12/) | [所見・制作差分](art/manifest-08-14.json) |
| 13 / `art/board-13.png` | 049–052 | 1774 × 887 | 3,061,629 | [12片](art/packed/board-13/) | [所見・制作差分](art/manifest-08-14.json) |
| 14 / `art/board-14.png` | 053–056 | 1774 × 887 | 2,988,747 | [12片](art/packed/board-14/) | [所見・制作差分](art/manifest-08-14.json) |
| 15 / `art/board-15.png` | 057–060 | 1774 × 887 | 2,892,789 | [12片](art/packed/board-15/) | [所見・制作差分](art/manifest-15-22.json) |
| 16 / `art/board-16.png` | 061–064 | 1774 × 887 | 2,800,181 | [11片](art/packed/board-16/) | [所見・制作差分](art/manifest-15-22.json) |
| 17 / `art/board-17.png` | 065–068 | 1774 × 887 | 2,342,490 | [9片](art/packed/board-17/) | [所見・制作差分](art/manifest-15-22.json) |
| 18 / `art/board-18.png` | 069–072 | 1774 × 887 | 2,724,821 | [11片](art/packed/board-18/) | [所見・制作差分](art/manifest-15-22.json) |
| 19 / `art/board-19.png` | 073–076 | 1774 × 887 | 2,867,731 | [11片](art/packed/board-19/) | [所見・制作差分](art/manifest-15-22.json) |
| 20 / `art/board-20.png` | 077–080 | 1774 × 887 | 2,310,877 | [9片](art/packed/board-20/) | [所見・制作差分](art/manifest-15-22.json) |
| 21 / `art/board-21.png` | 081–084 | 1774 × 887 | 2,320,055 | [9片](art/packed/board-21/) | [所見・制作差分](art/manifest-15-22.json) |
| 22 / `art/board-22.png` | 085–086 | 1536 × 1024 | 2,715,670 | [11片](art/packed/board-22/) | [所見・制作差分](art/manifest-15-22.json) |

## 各種と代表武器の対応

同一系列の上級化は数値だけでなく素材の面・縁・留め・器官の仕上げで変化させますが、その級別変化をこの比較画像だけで確定しないでください。下表の種名から、7武器・5防具部位・各級の正本JSONを開けます。

| No. | 種／設計JSON | この図の級 | 描いた代表武器 | ボード |
|---:|---|---|---|---:|
| 001 | [ガルドロス](data/species/001-galdros.json) | 初級 | 断岳剣・長尖槍 | 01 |
| 002 | [セルヴァルク](data/species/002-selvark.json) | 初級 | 双剣・環弓 | 01 |
| 003 | [ヌメラドン](data/species/003-numeradon.json) | 初級 | 護刃・太刀 | 01 |
| 004 | [ボルナケル](data/species/004-bornakel.json) | 初級 | 大槌・護刃 | 01 |
| 005 | [アシュレイア](data/species/005-ashreia.json) | 初級 | 太刀・環弓 | 02 |
| 006 | [ルミスカ](data/species/006-lumisca.json) | 初級 | 環弓・双剣 | 02 |
| 007 | [オルグラス](data/species/007-orglass.json) | 初級 | 護刃・長尖槍 | 02 |
| 008 | [テンガロ](data/species/008-tengaro.json) | 初級 | 双剣・太刀 | 02 |
| 009 | [ヴェリト](data/species/009-verito.json) | 初級 | 双剣・太刀 | 03 |
| 010 | [ラズメル](data/species/010-razmer.json) | 初級 | 長尖槍・断岳剣 | 03 |
| 011 | [キリサーヴ](data/species/011-kirisave.json) | 初級 | 双剣・環弓 | 03 |
| 012 | [ヴェルガイト](data/species/012-velgait.json) | 初級 | 環弓・太刀 | 03 |
| 013 | [エンバルグ](data/species/013-embarg.json) | 初級 | 断岳剣・大槌 | 04 |
| 014 | [コルドピル](data/species/014-kordopil.json) | 初級 | 断岳剣・護刃 | 04 |
| 015 | [パルセイト](data/species/015-palseit.json) | 初級 | 護刃・環弓 | 04 |
| 016 | [ヌマポロン](data/species/016-numaporon.json) | 初級 | 護刃・長尖槍 | 04 |
| 017 | [チルミカナ](data/species/017-chilumicana.json) | 初級 | 環弓・双剣 | 05 |
| 018 | [コハルギス](data/species/018-kohalgis.json) | 初級 | 護刃・長尖槍 | 05 |
| 019 | [ミトガロン](data/species/019-mitogaron.json) | 初級 | 双剣・太刀 | 05 |
| 020 | [ユルテピカ](data/species/020-yurtepica.json) | 初級 | 双剣・護刃 | 05 |
| 021 | [ヒナサルヴ](data/species/021-hinasalv.json) | 初級 | 環弓・長尖槍 | 06 |
| 022 | [ハスドレン](data/species/022-hasdren.json) | 中級 | 長尖槍・護刃 | 06 |
| 023 | [イヴセラム](data/species/023-ivselam.json) | 中級 | 双剣・太刀 | 06 |
| 024 | [ドメルカノ](data/species/024-domelkano.json) | 中級 | 大槌・断岳剣 | 06 |
| 025 | [ホルネバス](data/species/025-holnebas.json) | 中級 | 大槌・環弓 | 07 |
| 026 | [ミルタセア](data/species/026-miltasea.json) | 中級 | 太刀・環弓 | 07 |
| 027 | [タルグリナ](data/species/027-talgrina.json) | 中級 | 長尖槍・護刃 | 07 |
| 028 | [ザネトルカ](data/species/028-zanetolka.json) | 中級 | 双剣・太刀 | 07 |
| 029 | [ウルナセト](data/species/029-ulnaset.json) | 中級 | 長尖槍・護刃 | 08 |
| 030 | [ネムボラフ](data/species/030-nemboraf.json) | 中級 | 護刃・長尖槍 | 08 |
| 031 | [ボラゼルン](data/species/031-borazeln.json) | 中級 | 断岳剣・大槌 | 08 |
| 032 | [クドリマル](data/species/032-kudrimal.json) | 中級 | 長尖槍・双剣 | 08 |
| 033 | [トサムリエ](data/species/033-tosamurie.json) | 中級 | 双剣・太刀 | 09 |
| 034 | [プクレノア](data/species/034-pukrenoa.json) | 中級 | 双剣・太刀 | 09 |
| 035 | [ケサルピナ](data/species/035-kesalpina.json) | 中級 | 双剣・太刀 | 09 |
| 036 | [リプタウム](data/species/036-riptaum.json) | 中級 | 護刃・長尖槍 | 09 |
| 037 | [セリノダム](data/species/037-serinodam.json) | 中級 | 双剣・太刀 | 10 |
| 038 | [ヌフラケン](data/species/038-nufraken.json) | 中級 | 環弓・断岳剣 | 10 |
| 039 | [アカウネル](data/species/039-akaunel.json) | 中級 | 護刃・長尖槍 | 10 |
| 040 | [ツマロベク](data/species/040-tsumarobek.json) | 中級 | 大槌・護刃 | 10 |
| 041 | [フレムサド](data/species/041-furemsad.json) | 中級 | 大槌・護刃 | 11 |
| 042 | [グラセドン](data/species/042-grasedon.json) | 上級 | 断岳剣・大槌 | 11 |
| 043 | [リュゼルカ](data/species/043-ryuzelka.json) | 上級 | 環弓・双剣 | 11 |
| 044 | [モルディネ](data/species/044-mordine.json) | 上級 | 太刀・双剣 | 11 |
| 045 | [ドベルケン](data/species/045-doberken.json) | 上級 | 大槌・護刃 | 12 |
| 046 | [シルハトラ](data/species/046-shilhatora.json) | 上級 | 双剣・太刀 | 12 |
| 047 | [クザネリオ](data/species/047-kuzanerio.json) | 上級 | 護刃・長尖槍 | 12 |
| 048 | [フェスラミ](data/species/048-fesrami.json) | 上級 | 双剣・太刀 | 12 |
| 049 | [エルメジカ](data/species/049-elmejika.json) | 上級 | 環弓・太刀 | 13 |
| 050 | [アゼルノト](data/species/050-azelnoto.json) | 上級 | 長尖槍・護刃 | 13 |
| 051 | [ベズラキオ](data/species/051-bezrakio.json) | 上級 | 断岳剣・大槌 | 13 |
| 052 | [ムルゼナト](data/species/052-murzenato.json) | 上級 | 護刃・長尖槍 | 13 |
| 053 | [ハウレミカ](data/species/053-hauremika.json) | 上級 | 双剣・護刃 | 14 |
| 054 | [ゼドバニル](data/species/054-zedbanil.json) | 上級 | 護刃・断岳剣 | 14 |
| 055 | [オルダセム](data/species/055-oldasem.json) | 上級 | 断岳剣・護刃 | 14 |
| 056 | [ヌオルヴァン](data/species/056-nuolvan.json) | 上級 | 護刃・長尖槍 | 14 |
| 057 | [テムソギア](data/species/057-tarhegna.json) | 上級 | 断岳剣・大槌 | 15 |
| 058 | [ポルガミス](data/species/058-porgamis.json) | 上級 | 護刃・長尖槍 | 15 |
| 059 | [ヤルシェナ](data/species/059-yarlshena.json) | 上級 | 双剣・環弓 | 15 |
| 060 | [ピゼルタ](data/species/060-pizelta.json) | 上級 | 護刃・断岳剣 | 15 |
| 061 | [ダモリクス](data/species/061-damorikus.json) | 上級 | 護刃・長尖槍 | 16 |
| 062 | [イサルネム](data/species/062-isarnem.json) | 上級 | 太刀・断岳剣 | 16 |
| 063 | [レグサニオ](data/species/063-regsanio.json) | 上級 | 護刃・長尖槍 | 16 |
| 064 | [ルペニアス](data/species/064-rupenias.json) | 上級 | 断岳剣・太刀 | 16 |
| 065 | [ソグラピン](data/species/065-sograpin.json) | 上級 | 太刀・双剣 | 17 |
| 066 | [マクエジラ](data/species/066-makuejira.json) | 上級 | 環弓・断岳剣 | 17 |
| 067 | [グメサルド](data/species/067-gumesald.json) | 極級 | 断岳剣・護刃 | 17 |
| 068 | [ネリカウス](data/species/068-nericaus.json) | 極級 | 環弓・双剣 | 17 |
| 069 | [ヴォルテナ](data/species/069-voltena.json) | 極級 | 双剣・護刃 | 18 |
| 070 | [キトルナム](data/species/070-kitolnam.json) | 極級 | 双剣・太刀 | 18 |
| 071 | [セオルミド](data/species/071-segranio.json) | 極級 | 長尖槍・環弓 | 18 |
| 072 | [デコランゼ](data/species/072-dekoranze.json) | 極級 | 断岳剣・護刃 | 18 |
| 073 | [フサルドム](data/species/073-fusaldom.json) | 極級 | 護刃・長尖槍 | 19 |
| 074 | [リムポセラ](data/species/074-rimposera.json) | 極級 | 護刃・断岳剣 | 19 |
| 075 | [ダルホイナ](data/species/075-dalhoina.json) | 極級 | 断岳剣・大槌 | 19 |
| 076 | [ゾニケバル](data/species/076-zonikebal.json) | 極級 | 大槌・断岳剣 | 19 |
| 077 | [ルドパネア](data/species/077-ludopanea.json) | 極級 | 護刃・長尖槍 | 20 |
| 078 | [サルピノク](data/species/078-salpinoc.json) | 極級 | 護刃・長尖槍 | 20 |
| 079 | [ヘムザリオ](data/species/079-hemzario.json) | 極級 | 大槌・護刃 | 20 |
| 080 | [パスネリム](data/species/080-pasnelim.json) | 極級 | 双剣・太刀 | 20 |
| 081 | [ザクラトム](data/species/081-zaclatom.json) | 極級 | 太刀・環弓 | 21 |
| 082 | [イゾフラネ](data/species/082-izoflane.json) | 極級 | 護刃・長尖槍 | 21 |
| 083 | [クェリバス](data/species/083-queribas.json) | 極級 | 双剣・太刀 | 21 |
| 084 | [エナグリオ](data/species/084-enagrio.json) | 極級 | 長尖槍・環弓 | 21 |
| 085 | [ヌクバレア](data/species/085-nucbarea.json) | 極級 | 護刃・双剣 | 22 |
| 086 | [トワルセム](data/species/086-towalsem.json) | 極級 | 太刀・環弓 | 22 |

No057 テムソギアは既存ID `monster.tarhegna`、No071 セオルミドは `monster.segranio` を保持しています。画像のLatinラベルも既存IDに対応させており、和名から別のIDを作り直しません。

## 目視確認と、制作時に直す箇所

原画では全身、五領域、代表武器の種類、独立した盾、双剣2本、硬い槌の打面、環弓の弦と小環、特徴的な器官の位置・数を確認しました。器官数や形が異なった画像は生成後に画像編集で直し、修正プロンプトも保存しています。目視で確認した範囲は次の記録を正とします。

| 対象 | 目視所見・具体的差分の正本 | 主な扱い |
|---|---|---|
| 001–004 | [manifest-01.json](art/manifest-01.json) | 002の帆はさらに畳む。003の腹皮は主3層へ整理。001の尾端晶と004の肩可動域は別図で確認。 |
| 005–028 | [manifest-02-07.json](art/manifest-02-07.json) | 012背面を6灯、019を小幼鉤、021を4小板、025を3閉室へ修正。012弓の窓・026太刀の珠位置・028腕鉤など、残る差分を個別記録。 |
| 029–056 | [manifest-08-14.json](art/manifest-08-14.json) | 主棚と副甲の枚数、盾の硬い裏板、襟と頭防具の境界、肘の導管などを制作時に分けて確認。 |
| 057–086 | [manifest-15-22.json](art/manifest-15-22.json) | 小櫛・溝・房の厳密数、比較配置で短く見える槍、腕の可動域、背面の器官配置をJSONと照合。 |

**数・位置・形・握り・リーチが画像とJSONで異なる場合、JSONの明記仕様を優先してモデルを作ります。** 画像の見た目に合わせて武器の当たり判定、握り位置、共通リグ、器官数、素材の属性を変更しません。重なって見えない板を「存在しない」と判断したり、描写上の小じわを独立した主板として数えたりしないでください。

幼体素材の系列014–021も成人用防具です。未発達の小板・閉じた小耳膜・二燐節・小さい丸鉤・平たい羽袋を残し、成体装備の縮小版にも幼児体型にも変えません。

## 未検証の範囲と引き継ぎ

- 背面・側面の正投影、実寸、断面、左右の重なり、握り位置の最終確定。
- 共通リグでの最大可動域、肩上げ・屈伸・手首・指と装飾の干渉、衝突形状。
- 全7系統と全対象級の専用画像、正式3Dモデル、LOD、ゲーム内の描画・技能演出。
- 実機での読み取りやすさと、動作中に器官の点灯が分かるか。

ファイル検証は内容の欠落・破損・対応の誤りを検出するもので、形状の正しさや3Dの完成を証明するものではありません。制作の順序と接続先は [APPEARANCE_IMPLEMENTATION.md](APPEARANCE_IMPLEMENTATION.md) と [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) を参照してください。
