#!/usr/bin/env python3
"""Validate the complete packed image delivery and restored PNGs, without modifying images.

Python standard library only. Run materialize_art.py first in a fresh checkout.
The only file this script writes is analysis/art-validation.json.
It validates bytes and metadata, not 3D geometry or subjective visual quality.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zlib

PACKAGE = Path(__file__).resolve().parents[1]
FAMILIES = {'heavy_blade', 'guard_blade', 'war_maul', 'twin_blades',
            'long_blade', 'long_lance', 'ring_bow'}
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
ERRORS = []
CHECKS = Counter()


def check(condition, message, category):
    CHECKS[category] += 1
    if not condition:
        ERRORS.append({'category': category, 'message': message})
    return bool(condition)


def resolve_file(relative, category):
    if not check(isinstance(relative, str) and bool(relative),
                 'Missing or invalid relative path', category):
        return None
    raw = Path(relative)
    resolved = (PACKAGE / raw).resolve()
    if not check(not raw.is_absolute() and PACKAGE in resolved.parents,
                 f'Path escapes package: {relative}', category):
        return None
    if not check(resolved.is_file(), f'Missing file: {relative}', category):
        return None
    return resolved


def read_json(path, label, category):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        check(False, f'Cannot read {label}: {error}', category)
        return {}
    check(isinstance(value, dict), f'Expected JSON object: {label}', category)
    return value if isinstance(value, dict) else {}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png_dimensions(data, label):
    if not check(len(data) >= 33, f'PNG header too short: {label}', 'png'):
        return None
    check(data[:8] == PNG_SIGNATURE, f'PNG signature: {label}', 'png')
    check(data[8:12] == b'\x00\x00\x00\x0d' and data[12:16] == b'IHDR',
          f'First chunk must be a 13-byte IHDR: {label}', 'png')
    dimensions = list(struct.unpack('>II', data[16:24]))
    check(all(value > 0 for value in dimensions), f'Invalid dimensions: {label}', 'png')
    stored_crc = struct.unpack('>I', data[29:33])[0]
    check((zlib.crc32(data[12:29]) & 0xffffffff) == stored_crc,
          f'IHDR CRC mismatch: {label}', 'png')
    return dimensions


def main():
    index_path = resolve_file('art/packed-index.json', 'index')
    index = read_json(index_path, 'packed-index.json', 'index') if index_path else {}
    check(index.get('schemaVersion') == 1, 'Unsupported index schemaVersion', 'index')
    check(index.get('encoding') == 'raw-binary-concatenation-in-listed-order',
          'Unexpected packing encoding', 'index')
    check(index.get('partBytesMaximum') == 262140, 'Unexpected maximum part size', 'index')
    boards = index.get('boards', [])
    if not check(isinstance(boards, list), 'boards must be a list', 'index'):
        boards = []
    check(len(boards) == 22, 'Expected exactly 22 boards', 'coverage')

    seen_boards = []
    seen_species = []
    seen_species_ids = []
    seen_pngs = []
    seen_parts = []
    seen_prompts = set()
    metadata_cache = {}
    reports = []
    total_parts = 0
    total_png_bytes = 0
    total_representatives = 0

    for board in boards:
        if not check(isinstance(board, dict), 'Invalid board record', 'index'):
            continue
        number = board.get('board')
        if not check(type(number) is int and 1 <= number <= 22,
                     f'Invalid board number: {number}', 'index'):
            continue
        seen_boards.append(number)
        label = f'board-{number:02d}'
        file_name = board.get('file')
        seen_pngs.append(file_name)
        check(file_name == f'art/{label}.png', f'Unexpected PNG path: {file_name}', 'index')
        expected_sha = board.get('sha256', '')
        check(isinstance(expected_sha, str) and re.fullmatch(r'[0-9a-f]{64}', expected_sha),
              f'Invalid board SHA256: {label}', 'index')
        parts = board.get('parts', [])
        if not check(isinstance(parts, list) and bool(parts), f'No parts for {label}', 'parts'):
            parts = []
        combined = bytearray()
        for ordinal, part in enumerate(parts):
            if not check(isinstance(part, dict), f'Invalid part record in {label}', 'parts'):
                continue
            total_parts += 1
            part_name = part.get('path')
            seen_parts.append(part_name)
            check(part_name == f'art/packed/{label}/{ordinal:03d}.part',
                  f'Part order or path is wrong: {part_name}', 'parts')
            size = part.get('bytes')
            check(type(size) is int and 0 < size <= 262140,
                  f'Invalid part size: {part_name}', 'parts')
            if ordinal < len(parts) - 1:
                check(size == 262140, f'Only final part may be short: {part_name}', 'parts')
            part_path = resolve_file(part_name, 'parts')
            if part_path is None:
                continue
            data = part_path.read_bytes()
            check(len(data) == size, f'Part bytes mismatch: {part_name}', 'parts')
            check(digest(data) == part.get('sha256'), f'Part SHA256 mismatch: {part_name}', 'parts')
            git_sha = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
            check(git_sha == part.get('gitSha'), f'Part Git SHA mismatch: {part_name}', 'parts')
            combined.extend(data)
        joined = bytes(combined)
        check(len(joined) == board.get('bytes'), f'Joined PNG bytes mismatch: {label}', 'png')
        check(digest(joined) == expected_sha, f'Joined PNG SHA256 mismatch: {label}', 'png')
        joined_dimensions = png_dimensions(joined, label + ' joined')
        check(joined_dimensions == board.get('dimensions'), f'Joined IHDR dimensions mismatch: {label}', 'png')
        total_png_bytes += len(joined)

        original_path = resolve_file(file_name, 'png')
        original_dimensions = None
        if original_path is not None:
            original = original_path.read_bytes()
            check(len(original) == board.get('bytes'), f'PNG bytes mismatch: {label}', 'png')
            check(digest(original) == expected_sha, f'PNG SHA256 mismatch: {label}', 'png')
            check(original == joined, f'Restored PNG differs from packed bytes: {label}', 'png')
            original_dimensions = png_dimensions(original, label + ' file')
            check(original_dimensions == board.get('dimensions'), f'PNG IHDR dimensions mismatch: {label}', 'png')

        prompts = board.get('prompts', [])
        if not check(isinstance(prompts, list) and bool(prompts), f'No prompt for {label}', 'prompts'):
            prompts = []
        check(len(prompts) == len(set(prompts)), f'Duplicate prompt within {label}', 'prompts')
        for prompt in prompts:
            prompt_path = resolve_file(prompt, 'prompts')
            if prompt_path is not None:
                check(prompt_path.name.startswith(label) and prompt_path.suffix == '.txt',
                      f'Wrong board prompt path: {prompt}', 'prompts')
                check(bool(prompt_path.read_text(encoding='utf-8').strip()),
                      f'Empty prompt: {prompt}', 'prompts')
                seen_prompts.add(prompt)

        source_manifest = board.get('sourceManifest')
        metadata_path = resolve_file(source_manifest, 'metadata')
        if metadata_path is not None:
            if source_manifest not in metadata_cache:
                metadata_cache[source_manifest] = read_json(metadata_path, source_manifest, 'metadata')
            records = metadata_cache[source_manifest].get('boards', [])
            records = records if isinstance(records, list) else []
            source_boards = [record for record in records if isinstance(record, dict) and record.get('board') == number]
            if check(len(source_boards) == 1, f'Board missing or duplicated in {source_manifest}: {label}', 'metadata'):
                metadata = source_boards[0]
                check(metadata.get('sha256') == expected_sha, f'Manifest SHA256 differs: {label}', 'metadata')
                check(metadata.get('bytes', metadata.get('sizeBytes')) == board.get('bytes'),
                      f'Manifest bytes differ: {label}', 'metadata')
                check(metadata.get('dimensions') == board.get('dimensions'),
                      f'Manifest dimensions differ: {label}', 'metadata')
                source_numbers = [value if type(value) is int else value.get('no')
                                  for value in metadata.get('species', [])]
                check(source_numbers == [value.get('no') for value in board.get('species', [])],
                      f'Manifest species/order differs: {label}', 'metadata')

        species = board.get('species', [])
        if not check(isinstance(species, list), f'Invalid species in {label}', 'coverage'):
            species = []
        check(len(species) == (2 if number == 22 else 4), f'Wrong panel count: {label}', 'coverage')
        expected_numbers = list(range((number - 1) * 4 + 1, min(number * 4, 86) + 1))
        check([value.get('no') for value in species] == expected_numbers,
              f'Wrong species sequence: {label}', 'coverage')
        for entry in species:
            no = entry.get('no')
            seen_species.append(no)
            seen_species_ids.append(entry.get('speciesId'))
            families = entry.get('representativeFamilies', [])
            if not check(isinstance(families, list), f'Invalid families for {no}', 'coverage'):
                families = []
            check(len(families) == 2 and len(set(families)) == 2,
                  f'Expected two different representative families for {no}', 'coverage')
            check(all(family in FAMILIES for family in families), f'Unknown family for {no}', 'coverage')
            total_representatives += len(families)
            design_path = resolve_file(entry.get('designFile'), 'coverage')
            if design_path is not None:
                design = read_json(design_path, entry.get('designFile'), 'coverage')
                for key in ['no', 'speciesId', 'name']:
                    check(entry.get(key) == design.get(key), f'Design {key} differs for {no}', 'coverage')
                check(entry.get('representedRank') == design.get('nativeRank'),
                      f'Image must represent native rank for {no}', 'coverage')
        reports.append({'board': number, 'file': file_name, 'bytes': len(joined),
                        'sha256': digest(joined), 'dimensions': original_dimensions,
                        'parts': len(parts), 'species': [entry.get('no') for entry in species],
                        'representativeWeaponFamilies': sum(len(entry.get('representativeFamilies', [])) for entry in species),
                        'sourceManifest': source_manifest, 'prompts': prompts})

    check(sorted(seen_boards) == list(range(1, 23)), 'Boards are not unique 1..22', 'coverage')
    check(len(seen_pngs) == len(set(seen_pngs)), 'Duplicate PNG targets', 'coverage')
    check(len(seen_parts) == len(set(seen_parts)), 'A binary part is reused', 'coverage')
    check(Counter(seen_species) == Counter(range(1, 87)), 'Species are not unique 1..86', 'coverage')
    check(len(seen_species_ids) == 86 and len(set(seen_species_ids)) == 86,
          'Species IDs are not 86 unique values', 'coverage')
    check(total_representatives == 172, 'Expected exactly 172 representative families', 'coverage')
    actual = {'boards': len(boards), 'species': len(seen_species),
              'representativeWeaponFamilies': total_representatives, 'parts': total_parts,
              'originalPngBytes': total_png_bytes, 'prompts': len(seen_prompts)}
    expected = index.get('counts', {})
    for key, value in actual.items():
        check(expected.get(key) == value, f'Index count differs: {key}', 'index')
    report = {'schemaVersion': 1, 'checkedAtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'status': 'passed' if not ERRORS else 'failed',
              'command': 'python3 chatgpt-inbox/equipment-specialization-20261126/reference/validate_art.py',
              'scope': 'Local packed bytes, restored PNG bytes/IHDR, identity coverage and prompt presence. PNGs are never modified.',
              'counts': actual, 'checks': sum(CHECKS.values()), 'checksByCategory': dict(CHECKS),
              'errors': ERRORS, 'boards': reports,
              'visualReviewSources': sorted(metadata_cache),
              'notVerified': ['GitHub branch/tree attachment and remote fetch: verified separately by publication workflow',
                              'Full PNG pixel decoding: visual reviews are recorded in the source manifests',
                              '3D geometry, orthographic views, real dimensions, maximum rig motion and collision',
                              'Every rank and all seven weapon families as individual images',
                              'In-game rendering, performance and skill cue visibility']}
    output = PACKAGE / 'analysis/art-validation.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'counts': actual, 'checks': report['checks'],
                      'errors': len(ERRORS), 'report': str(output)}, ensure_ascii=False))
    if ERRORS:
        for error in ERRORS[:20]:
            print(error['category'] + ': ' + error['message'], file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
