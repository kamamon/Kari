#!/usr/bin/env python3
"""Validate request 011 ticket shape and current action identifiers; no game writes."""
import json
from pathlib import Path
base=Path(__file__).resolve().parent
repo=base.parents[1]
files=sorted(base.glob('*.json'))
manifest=json.loads((base/'MOTION_INDEX.json').read_text(encoding='utf8'))
expected={x['path'] for x in manifest['items']}
actual={x.name for x in files if x.name != 'MOTION_INDEX.json'}
assert expected==actual, ('file list mismatch',sorted(expected-actual),sorted(actual-expected))
assert len(actual)==41
known={}
for path in (repo/'public/data/actions').glob('*.json'):
    try: obj=json.loads(path.read_text(encoding='utf8'))
    except Exception: continue
    for action in obj.get('actions',[]):known[action['actionId']]=action
for name in sorted(actual):
    doc=json.loads((base/name).read_text(encoding='utf8'))
    assert doc['schemaVersion']==1 and doc.get('kariActionId') and doc.get('source'), name
    assert len(doc['keys'])==5 and [x['key'] for x in doc['keys']]==['K0','K1','K2','K3','K4'],name
    assert doc['evidenceStatus'].startswith('暫定'),name
    for item in doc['keys']:
        for field in ('time','support','feet','pelvis','chest','head','weapon','root','notes','valueBasis'): assert field in item,(name,field)
        assert set(('L','R')).issubset(item['feet']),name
        for field in ('height','yaw','pitch','roll'):assert field in item['pelvis'],(name,field)
        for field in ('yaw','pitch','roll'):assert field in item['chest'],(name,field)
        for field in ('grip','tip','edge','leftHand'):assert field in item['weapon'],(name,field)
        assert item['time']=='未測定',name
    if doc['kariActionId'].startswith('player.'):
        assert doc['kariActionId'] in known,doc['kariActionId']
        ref=doc.get('kariReference') or {}
        if 'durationTicks' in ref:assert ref['durationTicks']==known[doc['kariActionId']]['durationTicks'],name
print('PASS: 41 provisional tickets; known action IDs and durations; K0-K4 fields. Origin gameplay verification NOT performed.')
