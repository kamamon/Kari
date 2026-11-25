"""Check all primary concept files and preserve a portable artwork manifest."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

P = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--draft', action='store_true')
args = ap.parse_args()
doc = json.loads((P / 'data/all-equipment.json').read_text())
entries, errors, missing = [], [], []
for s in doc['series']:
    path = P / s['artFile']
    if not path.is_file():
        missing.append({'no': s['no'], 'name': s['name'], 'path': s['artFile']})
        continue
    with Image.open(path) as im:
        im.load()
        dims, mode, fmt = list(im.size), im.mode, im.format
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    review = s.get('artReview', {})
    if review.get('sha256') and review['sha256'] != sha:
        errors.append({'no': s['no'], 'issue': 'review SHA differs from primary file'})
    reviewed = review.get('status') in ['reviewed', 'visually-reviewed'] or (
        review.get('generated') is True and
        review.get('sevenWeaponGroupsVisible') is True and
        review.get('fiveArmorRegionsVisible') is True)
    if not reviewed:
        errors.append({'no': s['no'], 'issue': 'missing completed visual review'})
    if review.get('clippingObserved') or review.get('croppingObserved'):
        errors.append({'no': s['no'], 'issue': 'unresolved clipping review'})
    if fmt != 'PNG':
        errors.append({'no': s['no'], 'issue': 'primary source is not PNG'})
    entries.append({'no': s['no'], 'seriesId': s['id'], 'name': s['name'],
                    'seriesName': s['seriesName'], 'sourceSpeciesId': s.get('sourceSpeciesId'),
                    'nativeRank': s['nativeRank'],
                    'availableRanks': list(range(s['nativeRank'], 5)),
                    'artFile': s['artFile'], 'promptFile': s['artPromptFile'],
                    'sha256': sha, 'bytes': path.stat().st_size,
                    'dimensions': dims, 'mode': mode, 'visualReview': review,
                    'catalogDesignPage': 11 + 2 * (s['no'] - 1),
                    'catalogStatsPage': 12 + 2 * (s['no'] - 1)})
if len({x['sha256'] for x in entries}) != len(entries):
    errors.append({'issue': 'duplicate primary artwork bytes'})
manifest = {'sourceCommit': doc['sourceCommit'],
            'scope': 'One native-rank concept per series; higher-rank changes are written specifications.',
            'expectedPrimaryArt': 95, 'primaryArt': len(entries),
            'primaryBytes': sum(x['bytes'] for x in entries), 'entries': entries}
(P / 'data/art-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
report = {'primaryImages': len(entries), 'expectedImages': 95,
          'allPrimaryFilesUnique': len({x['sha256'] for x in entries}) == len(entries),
          'missing': missing, 'errors': errors, 'nativeRankImagesOnly': True,
          'allGradesHaveWrittenAppearance': len(doc['rankVariants']) == 250,
          'passed': not missing and not errors, 'draft': args.draft,
          'scope': 'File/hash/review-record checks plus individual visual review by the generating agents. No 3D or orthographic validation.'}
(P / 'analysis/art-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
if errors or (missing and not args.draft):
    raise SystemExit(1)
