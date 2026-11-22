# art-source

原画・設定図・キー画などの **編集原本** を置く場所。配信物（dist）には含めない。

- ここへ置いたファイルは `docs/asset-manifest.json` に id・版・出所を登録する。
- ゲームが実行時に読む素材（256px のアイコン、GLB、音）は `public/assets/` へ置く。
- 直した時は `_v2` のように版を上げ、古い版は消さない。
- ファイル名の決まりは `docs/chatgpt-requests.md` の「受け取るファイルの名前」。
