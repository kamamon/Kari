#!/usr/bin/env python3
"""Restore the original, byte-identical PNGs from the checked-in binary parts.

No dependencies, no network, no code execution from data, no image transformation.
Run from anywhere: python3 <package>/reference/materialize_art.py
"""
import hashlib
import json
from pathlib import Path

package = Path(__file__).resolve().parents[1]
manifest = json.loads((package / 'art/packed-index.json').read_text())
for board in manifest['boards']:
    chunks = []
    for part in board['parts']:
        source = (package / part['path']).resolve()
        if package not in source.parents:
            raise ValueError('Part escapes the package')
        data = source.read_bytes()
        if len(data) != part['bytes'] or hashlib.sha256(data).hexdigest() != part['sha256']:
            raise ValueError(f'Corrupt part: {part["path"]}')
        chunks.append(data)
    data = b''.join(chunks)
    if len(data) != board['bytes'] or hashlib.sha256(data).hexdigest() != board['sha256']:
        raise ValueError(f'Corrupt board: {board["file"]}')
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Not a PNG')
    target = (package / board['file']).resolve()
    if package not in target.parents:
        raise ValueError('Output escapes the package')
    if target.exists() and target.read_bytes() != data:
        raise ValueError(f'Different local file already exists: {target}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(f'{board["file"]}: {len(data)} bytes, SHA256 verified')
print(f'Restored {len(manifest["boards"])} original PNGs without changing one byte.')
