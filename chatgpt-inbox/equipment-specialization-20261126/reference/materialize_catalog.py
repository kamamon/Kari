#!/usr/bin/env python3
"""Combine the complete checked-in shards. Explicit output; never writes game files."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
base = Path(__file__).resolve().parents[1] / 'data'
load = lambda path: json.loads(path.read_text())
index = load(base / 'index.json')
groups = [load(base / row['path']) for row in index['series']]
result = {'format': index['format'], 'runtimeImportable': False, 'counts': index['counts'],
          'series': [{k:v for k,v in s.items() if k not in ('weapons','armor','recipes','ranks')} for s in groups],
          'weaponCandidates': [x for s in groups for x in s['weapons']],
          'armorCandidates': [x for s in groups for x in s['armor']],
          'recipes': [x for s in groups for x in s['recipes']],
          'rankVariants': [x for s in groups for x in s['ranks']],
          'materials': [x for p in index['materials'] for x in load(base/p)],
          'mechanics': [x for p in index['mechanics'] for x in load(base/p)],
          'appearance': [x for p in index['appearance'] for x in load(base/p)]}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'{args.output}: {len(result["weaponCandidates"])} weapons, {len(result["armorCandidates"])} armor, {len(result["recipes"])} recipes')
