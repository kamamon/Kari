# 攻撃力差し替えパッケージ

対象は main `1d8e084d0d16fe77c376570f9542dd3c54fb5332`（v0.20.0）。これはClaudeが確認して取り込むための提案で、main/公開中のゲームは変更していない。

## 内容

- `balance.patch`: 武器7系統の攻撃データ7ファイルと、生成元6ファイルの差分。全33の攻撃行動を対象とする。
- `replacement/`: 上記13ファイルの置き換え後の内容。変更先は元の階層のまま。
- `manifest.json`: 基点と13ファイルの変更前後SHA256。
- `test-expectations.patch` / `test-replacement/`: 既存2テスト内の独立した正確な期待値を新しい数値に合わせる差分。テストを削除したり、曖昧な`>0`へ変えたりしていない。
- `test-expectations-manifest.json`: テスト差分の変更前後SHA256。
- `build_balance.py`: 基点のファイルからこのパッケージと表を再生成する。実ゲームのsrc/public/tools/testsは書き換えず、このinbox内にだけ出力する。
- `measure_balance.mjs`: 実際の`stepPlayer`と`computeDamage`を使う時間・連携・資源の制御試験。元のデータと、メモリ上に読んだ提案データを比較する。基点の13ファイルが変わっていれば止まる。

設計: `../../analysis/balance-design.md`。全技表: `balance-motion-values.json` と `.csv`。測定: `balance-runtime-report.json` と `.md`。難易度の仮説: `balance-difficulty-scenarios.json`。いずれも`../../analysis/`内。

## 数値の要点

MVは係数×100。主連携は護刃24→30→56、双剣18→22→30+30、太刀38→44→72、長尖槍36→42→72。大槌は60→76と連携後半を高める（循環するため真の終端ではない）。単発で自由に出せない技を、独立して連打できるものとして評価しない。

溜め倍率は断岳剣1/1.5/2.1/2.8（基礎1.05）、大槌1/1.7/2.55/3.8（基礎0.72）。弓の矢の係数は0.22/0.58/1.12/1.85、散らしは1本0.17。ヒット単位で切り捨てる既存式を維持する。

実際の攻撃tick、射撃tick、キャンセルtick、移動、向きの変更、スタミナ規則、刃の規則、武器攻撃力、敵HPは維持する。例外は分類上のactive終端だけ。弓の発射tickと双剣の二段目の最後のtickをactiveへ含め、双剣二段突きのtrail終了も20→21へ一致させた。実命中枠を伸ばした変更ではない。

## 再現の手順

Node.js 22以上と依存関係が必要。`npm ci`を先に実行する。比較は、元のランタイムにこのinboxだけを加えたチェックアウトから行う。

```sh
python chatgpt-inbox/motion-combat-20261125/implementation/balance/build_balance.py
node chatgpt-inbox/motion-combat-20261125/implementation/balance/measure_balance.mjs
```

この比較は全ての命中枠を開始時に当て、矢を全本命中させる制御試験。敵AI・地形・人体/敵の当たりの幾何・刃の消耗・飛行時間は除外する。実際のヒットストップ、合法な派生、溜め、勢いの速さ、スタミナの消費と回復は実行する。刃の名目消費は別に集計する。実機のDPSとは言わない。

採用検証は別の作業コピーで行う。下の`PAYLOAD`にはこのフォルダの絶対パスを設定する。実行場所は検証用チェックアウトのルート。

```sh
git apply --check "$PAYLOAD/balance.patch"
git apply "$PAYLOAD/balance.patch"
git apply --check "$PAYLOAD/test-expectations.patch"
git apply "$PAYLOAD/test-expectations.patch"
node --experimental-strip-types --no-warnings tools/gen-weapons.mjs --strict
npm test -- tests/combat.test.ts tests/edge.test.ts tests/weapons.test.ts tests/content.test.ts
npm run check
```

モーションの差分も受け入れる場合は生成元を両方統合してから`gen-weapons`を実行する。生成したJSONだけを手修正すると次の生成で消える。別の基点へ移すときはSHA256の不一致を無視して上書きせず、同じ行動IDの変更を確認して移植する。

## 実行した確認

- パッケージ生成: 13の置き換えファイル。7系統、33攻撃行動、38近接命中枠、42の溜め段階込み表。
- 実コードの制御試験: 42単独行動、37反復経路、7つの不変条件を通過。条件には「主連携が始動連打を上回る」「長尖槍3段が一段→上段だけを上回る」「待ち時間込みで溜めの名目DPSが増える」「全ての実命中・発射時刻がactiveへ含まれる」を含む。
- 独立した検証用コピーで、`gen-weapons.mjs --strict`を実行。44行動・48軌道・42身体モーションを再生成し、人間の関節等の既存検査を通過。再生成後の13ファイルは置き換えファイルとバイト単位で一致。
- 同コピーで`combat`/`edge`/`weapons`/`content`の4スイート、78テストが全件通過。初回のコピーには`art-source/`が無く素材実在確認1件が失敗したが、読み取り用に原本を含めてから同じ78件を再実行して通過。

全体の型検査・ビルド・他スイートとの統合結果は、親パッケージの検証記録を確認する。

## 決めたこと・残る確認

リポジトリの役割分担に合わせて、書き込みはinboxだけにした。本体へ差し替えるコード/データの案を作ったことを、公開反映済みと扱わない。既存ゲームから数値を複写せず、このリポジトリの実際の時間・判定・入力経路から配分した。

気絶の仕組みは現在無いので、大槌や盾打ちが気絶を取れる前提で価格付けしていない。多段の最後が外れた場合や、実際の敵が動く場合の成功率は未測定。最大溜めの弓を最速で繰り返すと途中からスタミナ切れで低段階になる。最大溜めだけを保証する回復待ち経路、最大溜め→散らし3回経路も別に測定した。

刃の消耗、部位破壊からの拘束連鎖、弓の実際の命中本数、受け返しの成功率、全大型・幼体・群れ・強化段階、iPhoneでの操作感と難易度は採用時に確認する。設計資料の討伐時間は行動比率を置いた仮説で、実測の合格値ではない。
