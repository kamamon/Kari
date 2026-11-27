# スパインゲイル V2（初級〜上級、専用リグ試作）
利用者指示：falなし。初級原種は中級・上級にも出現する。素材・装備を級別にする。
V1の初級設計を保持し、v2級別表で上書きする。既存図鑑No.2/セルヴァルクとIDは変更しない。極級は追加しない。

## 返したファイル
- build_spinegale.py: Pythonで専用メッシュ、骨階層、UV、スキニング、GLB内蔵テクスチャ、アニメーションを生成する実行可能ソース。
- build_progression.py: 素材アイコン21枚、級別の装備・レシピ・報酬表を生成。前者が生成したtexturesを使う。
- rank_progression_v2.json: 素材21、武器7系統×3級=21、防具5部位×3級=15。現行schema未変換の提案。
- このREADME。GLB・PNGのバイナリは会話で提供。GitHubへ直接転送していないが、同一生成ソースをハッシュ照合の上登録。
## 再生成（Linux / Python 3.12以降を想定）
```sh
python -m pip install numpy scipy Pillow
python build_spinegale.py
SPINE_LOD=.65 SPINE_SUFFIX=mobile python build_spinegale.py
python build_progression.py
```
WindowsはPowerShellで環境変数を設定。素材一覧のプレビューシートのみLinux DejaVuフォントのパスを参照するため、必要ならローカルフォントへ置換。
## 実生成結果
- spinegale_v2.glb: 9,962,292 bytes、頂点45,411、80,440三角形。
- spinegale_mobile.glb: 7,924,960 bytes、頂点19,395、32,074三角形。
- 両方: 77関節（74が頂点に直接重みを持つ）、53クリップ、2,069チャンネル、8材質、15埋込PNG（512×512、basecolor/normal/ORM）。
- 60tick/s、+Y上、+Z前、m。全長約6.34m、全高約2.25m。sg_fatigue_full 600tickと始動・ループ・復帰分割あり。中級540tick、上級480tickはループを詰める設計。
## 確認と制約
会話側でGLBヘッダ、バッファ境界、インデックス、正規化ウェイト、関節階層、正規化四元数、時刻単調増加、ループ端一致、PNG読込、素材抽選100%、レシピ参照、アイコンの寸法・透過を検査した。CPU描画で待機、疲労、跳躍、別角度の実モデルを確認。疲労時の尾を下げるよう修正。WebGL2は検証環境で利用不能、iPhone/King/Kariでは未確認。Blender編集、正式な当たり判定、足接地全tick検査は未実施。
手続き型試作であり、原画同等の実写品質ではない。中級・上級の差分メッシュ、武器防具の3D本体は未生成（名称・性能・外観設計のみ）。水平移動はゲームcontrollerを正本とする。跳躍と転倒クリップの垂直root変位をゲーム側で二重適用しない。攻撃窓はclip extrasの提案で、正式shapeTrackは未作成。
Claudeへ：ID/装備schema照合、骨名契約と正式軌道、疲労AI、級別報酬・工房、King検証、実機予算を確認して採否を決める。本体mainは変更しない。
