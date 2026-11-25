# 参照・採用状態・看板担当との接続

作成: 2026-11-26（日本時間） / 対象: kamamon/Kari\
基準: main `0925487b686473e1a4d7e45fdc63449ef3a7d2ec` / v0.34.0。\
この提出は物語・美術・制作設計の追加案。ゲーム本体を変更していない。

## 1. 正本の順序

既に動く状態は public/data と src を正とし、採用履歴は docs/chatgpt-board.md を参照する。docs/source 内のv1は受領時の原本であり、その冒頭の「未採用」を現在の採用状態へ読み替えない。別作業中の看板案は main に未登録であるため、採用済み扱いにはしない。

| 事項 | 今回確認した内容 | 根拠 |
| --- | --- | --- |
| 担当範囲 | ChatGPTは絵・世界観・考案・レビュー。提出はinboxとPR、公開はClaude | [AGENTS.md](https://github.com/kamamon/Kari/blob/0925487b686473e1a4d7e45fdc63449ef3a7d2ec/AGENTS.md) |
| 採用物語 | 帰り道の灯、PR #7採用、S0導入 | [掲示板](https://github.com/kamamon/Kari/blob/0925487b686473e1a4d7e45fdc63449ef3a7d2ec/docs/chatgpt-board.md) |
| 実装済み | story.homeward_lights、ch0/ch1、sc00〜sc03。ch2以降は予告 | [story.json](https://github.com/kamamon/Kari/blob/0925487b686473e1a4d7e45fdc63449ef3a7d2ec/public/data/story.json) |
| 旧主線 | ST01〜ST14。ST14はセオルミド、恒久ID monster.segranio | [主線対応表](https://github.com/kamamon/Kari/blob/0925487b686473e1a4d7e45fdc63449ef3a7d2ec/docs/source/chatgpt-quest-design-20261125/story_quest_map_v1.json) |
| 画風 | 落ち着いた自然素材、石・木・布・皮・青銅、読み取れる器官 | [採用基準](https://github.com/kamamon/Kari/blob/0925487b686473e1a4d7e45fdc63449ef3a7d2ec/art-source/board/style_board_v2.png) |
| 里 | 現行は広場0m・炉の段−3m。5段・32mの構想は全実装ではない | 掲示板のPR #11、docs/source/chatgpt-hub-design-20261125/ |
| 人物 | ミナギ、ロクハ、イサネ、セナキ。既存原画を継承、人物名の仮表記は現行noteを保持 | public/data/story.json、art-source/npc/ |
| 既存素材 | PR #13の24点受領、うち13点使用開始 | 掲示板、docs/source/chatgpt-story-art-20261125/catalog.md |
| 保存 | schemaVersion 5、questClearsが主線の正本。既読・結果履歴を恒久保存していない | src/save/profile.ts、src/data/story.ts、src/app.ts |
| テンガロ | 無属性、痺液による麻痺。雷属性へ変更しない | public/data/bestiary.json の monster.tengaro |
| セオルミド | 風・霧、雷弱点、state=art、未プレイ。終盤役は維持 | public/data/bestiary.json の monster.segranio |

## 2. 同時制作中の看板案

看板資料の更新を作業中に確認した。参照を固定するため、references/にその時点の文書と全身原画を同梱した。原画はこの提出で新規生成した4点には数えない。参照元は同じKari案件の別制作フォルダで、取得時点ではmainの追跡ファイルではない。後で看板提出が更新された場合、正式に採用された資料を優先し、差分を物語側にも反映する。

- 元の提出場所: chatgpt-inbox/user-20261126-thunder-wyverns/
- 文書: references/orzelion_design_reference_v1.md
- 原画: references/orzelion_concept_reference_v1.png
- 取得時のSHA-256と元パス: references/reference_manifest.json

### 継承する内容

鳴天竜オルゼリオン、提案恒久ID monster.orzelion。原種・大型・中級rank.2、雷、氷弱点・雷耐性の案。主生息地は鉛雲高地、雨裂断崖への短距離巡回、錆星高原で鉱物藻を舐める。高地の小型獣などを食べ、天候に制約される。全域の雷雲を作る存在ではない。

翼腕2と後脚2の4肢。後方へ流れる平たい冠角2本、翼前縁の二条導電板、尾端は3枚を束ねた槍。胸の左右蓄雷嚢から翼前縁、尾槍へ電荷を流す。冠角自体を可動の蝶番・電気の発生源にしない。翼指・趾・左右差など、場面原画で隠れた構造は「確認済み」としない。

### 物語側で追加した判断

| 看板側の接続案 | 今回の接続 | 採用前に照合すること |
| --- | --- | --- |
| 中級終盤の初対峙 | TQ07をST08後の任意中級狩猟として用意 | 本来の鉛雲高地・中級個体・技を制作できた時に解禁 |
| ST01〜ST14を維持 | 既存14件を残し、TQ04で看板の新しい決戦を追加 | ch8の対象・旧達成履歴を上書きしない |
| 原種rank.2 | 最終TQ04と再戦TQ06のrank.4は依頼別の強さの提案 | 種の初出rank.2を変更しない。上位素材・倍率は実戦調整待ち |
| 生息地は鉛雲高地 | 「鳴天の背」は高地内の休息棚・点検路小区域 | 重霧環谷の上流と断定せず、補給・帰路の接続をフィールド担当が定義 |
| 道と休息路の重なり | 湧水・湿りの長期変化で利用できる棚が偏ったという観測仮説 | 本来の鉱物補給・食性・嵐前の着地と矛盾させない |

追加決戦は今回のユーザーのストーリー深化指示への提案であり、看板資料の中級エピソード案を「既に最終ボスに採用された」と読み替えたものではない。最終役の追加は本書とstory_bible_v2.mdで明示した差分として渡す。

## 3. 本提出で確定しないもの

看板の登録採用、3Dメッシュ、UV/PBR、リグ、モーション、当たり判定、飛行AI、捕獲対応、難易度、報酬量、新フィールドの水理・地理、iPhone性能は別工程。JSONはproposal専用であり、public/data/story.jsonやクエスト定義の置換ファイルではない。

物語本文・台詞・字幕・原画の構図は今回新たに書いた創作。実在生物の電気器官や現実の電気工事の説明ではない。人の装置は架空世界の美術案で、雷攻撃を自動無効化したり飛竜を操作する道具にはしない。

## 4. 守れなかった決まり・迷ったこと・未確認

- 既知の担当範囲逸脱はない。追跡対象の変更は今回のinboxフォルダのみ。
- 迷って決めたこと: 旧最終役を消さず追加章へ看板決戦を置く。最小本筋は15狩猟、任意中級対峙は含めない。里の人は既存4人を深める。
- 未確認: 詳細設計と生成画の全方向一致、戦闘中の可読性・音量・速度、後半地域・設備の実装。本文内の目安値は実測値ではない。
- 検査の実行結果はvalidation_report.mdを参照。未実装項目を合格したと記録しない。


## 5. 提出直前の並行作業

確認時点で、級別受付・星別一覧・小アイコンは [PR #17](https://github.com/kamamon/Kari/pull/17)（chatgpt/quest-reception-20261126）として提出済み。今回のreceptionGrade/stars/boardLaneはその採用後の正式クエストIDへ対応させる。PRを確認しただけでmainへ取り込み済みとしない。main基点は引き続きv0.34.0である。

高地へ向かう必然性を明確にするため、本案ではch3から臨時輸送と定期輸送の不足区間を示す。重霧環谷で安全な帰路、鉛雲高地で荷と補修部材を通す残る往路・点検路を整え、両方が揃って日常の運用へ戻る。これは今回追加した輸送・地理案であり、水路の直結を意味しない。
