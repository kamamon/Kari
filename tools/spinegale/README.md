# Spinegale / 疾棘竜

`npm run spinegale:build` で、採用原画から生成したゲーム用 GLB を再現する。predev / pretest / prebuild で存在・構造を検証し、無ければ再生成する。Python 3.11 以上と requirements.txt の依存関係を使用。必要時は tools/out 内の venv にインストールする。外部生成サービスは使用しない。

ゲーム用モデル: 171,772 triangles, 77 joints, 53 clips, 8 materials, 1024 textures. 元のゲーム用 GLB SHA-256: `1af14a068028067aadef271b5ae9c42876a1804a6883061d985320b8c7f60b42`。生成環境により圧縮差が出る場合は形状・関節数・クリップ名と長さを検査する。

全11系統の装備定義・69アイコンを収録。現在の7系統のみ利用可能とし、残り4系統は当該武器のモーションセットとともに有効になる。既存モンスター・装備・セーブIDを改変しない。図鑑 No.87、登場順はガルドロス討伐後。
