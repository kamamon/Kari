"""Compose before/after panels from actual CPU mesh exports, without altering geometry."""
from pathlib import Path
import argparse
import json
from PIL import Image, ImageDraw, ImageFont
from render_geometry import render


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_json', type=Path)
    parser.add_argument('proposed_json', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    old = {x['name']: x for x in json.loads(args.baseline_json.read_text())['snapshots']}
    new = {x['name']: x for x in json.loads(args.proposed_json.read_text())['snapshots']}
    out = args.output_directory
    out.mkdir(parents=True, exist_ok=True)
    font = lambda n: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', n, index=0)
    canvas = Image.new('RGB', (1440, 1160), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((28, 16), '断岳剣・横薙ぎ / 同じ武器軌道で身体の支え方を変更', font=font(31), fill='#193a32')
    draw.text((28, 61), '上: 現行    下: 差し替え案    |    時刻 18 / 26 / 34 tick', font=font(22), fill='#496056')
    for row, source in enumerate([old, new]):
        for col, tick in enumerate([18, 26, 34]):
            canvas.paste(render(source[f'heavy_sweep_{tick}'], 480, 490), (col * 480, 110 + row * 505))
    draw.text((30, 1120), '骨盤でひねりを受け、膝と踏み替えで支持。図はCPU計算の形状比較で、ゲーム映像ではない。', font=font(20), fill='#496056')
    canvas.save(out / 'heavy-comparison.png')
    canvas = Image.new('RGB', (1400, 1070), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((25, 14), '歩行の時刻サンプル / solveState の位相を修正', font=font(31), fill='#193a32')
    draw.text((25, 58), '現行: 時刻を変えても同じ足の位相を繰り返す', font=font(23), fill='#496056')
    for col in range(4):
        canvas.paste(render(old[f'gait_{col}'], 350, 450), (350 * col, 100))
    draw.text((25, 558), '差し替え案: 0.00 / 0.16 / 0.32 / 0.48 秒で実際に脚が切り替わる', font=font(23), fill='#496056')
    for col in range(4):
        canvas.paste(render(new[f'gait_{col}'], 350, 450), (350 * col, 600))
    canvas.save(out / 'gait-comparison.png')
    print('Saved two CPU geometry comparison figures.')


if __name__ == '__main__':
    main()
