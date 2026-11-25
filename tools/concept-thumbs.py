#!/usr/bin/env python3
"""モンスターの原画（art-source/monster/concepts/*.png）から、図鑑に出す小さな絵を作る（npm run bestiary:thumbs）。

  art-source/monster/concepts/<名前>.png  →  public/assets/bestiary/<名前>.webp（幅 720px）
  登録簿の art に「/」がある時は art-source/monster/ からの道（ガルドロスの設定図 galdros/galdros_left_v1.png）。出力はファイル名だけ。

原画そのものは art-source に置いたまま（ゲームは読まない）。出力は手で編集しない。
登録簿（public/data/bestiary.json）の art に書かれた名前のうち、原画が無いものは、名前を出して終わる（失敗）。
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-source', 'monster', 'concepts')
MONSTER = os.path.join(ROOT, 'art-source', 'monster')
OUT = os.path.join(ROOT, 'public', 'assets', 'bestiary')
WIDTH = 720


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, 'public', 'data', 'bestiary.json'), encoding='utf-8') as f:
        wanted = sorted({s['art'] for s in json.load(f)['species'] if s.get('art')})
    def src(n):
        return os.path.join(MONSTER, n) if '/' in n else os.path.join(SRC, n)
    missing = [n for n in wanted if not os.path.exists(src(n))]
    if missing:
        print('原画がありません:', ', '.join(missing))
        return 1
    total = 0
    for name in wanted:
        img = Image.open(src(name)).convert('RGB')
        h = round(img.height * WIDTH / img.width)
        out = os.path.join(OUT, os.path.splitext(os.path.basename(name))[0] + '.webp')
        img.resize((WIDTH, h), Image.LANCZOS).save(out, 'WEBP', quality=80, method=6)
        total += os.path.getsize(out)
        print(os.path.basename(out), f'{WIDTH}x{h}', os.path.getsize(out) // 1024, 'KB')
    print('total', total // 1024, 'KB,', len(wanted), 'files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
