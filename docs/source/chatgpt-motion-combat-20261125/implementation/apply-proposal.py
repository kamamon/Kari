#!/usr/bin/env python3
"""Check or apply the reviewed proposal without overwriting changed target files.

Default: read-only check. --apply writes the patch. --reverse checks/removes it.
Run against a separate integration checkout, as required by this repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys


def sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True, help='integration checkout root')
    parser.add_argument('--apply', action='store_true', help='write after all checks pass')
    parser.add_argument('--reverse', action='store_true', help='check/remove the proposal')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    spec = json.loads((here / 'manifest.json').read_text(encoding='utf-8'))
    patch = here / spec['patch']
    if sha256(patch) != spec['patchSha256']:
        raise ValueError('Patch checksum differs from manifest; no changes made.')
    root = args.repo.resolve(strict=True)
    actual_root = Path(subprocess.check_output(
        ['git', 'rev-parse', '--show-toplevel'], cwd=root, text=True).strip()).resolve()
    if root != actual_root:
        raise ValueError('--repo must name the checkout root; no changes made.')
    before = 'afterSha256' if args.reverse else 'beforeSha256'
    after = 'beforeSha256' if args.reverse else 'afterSha256'
    paths: list[tuple[Path, dict]] = []
    for item in spec['files']:
        rel = PurePosixPath(item['path'])
        if rel.is_absolute() or '..' in rel.parts or not rel.parts:
            raise ValueError(f'Unsafe target path: {rel}')
        target = root.joinpath(*rel.parts)
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError(f'Symlink or escaped target path: {rel}')
        if target.exists() and not target.is_file():
            raise ValueError(f'Target is not a regular file: {rel}')
        if sha256(target) != item[before]:
            raise ValueError(f'{rel}: content differs from the expected input; no changes made.')
        paths.append((target, item))
    if len(paths) != spec['fileCount'] or len({p for p, _ in paths}) != len(paths):
        raise ValueError('Invalid file count or duplicate targets in manifest.')
    direction = ['--reverse'] if args.reverse else []
    subprocess.run(['git', 'apply', '--check', *direction, str(patch)], cwd=root, check=True)
    if not args.apply:
        print(f'OK: {len(paths)} target files match; patch can be applied'
              + (' in reverse.' if args.reverse else '.'))
        print('Read-only check. Add --apply to write to this checkout.')
        return
    subprocess.run(['git', 'apply', *direction, str(patch)], cwd=root, check=True)
    mismatches = [i['path'] for p, i in paths if sha256(p) != i[after]]
    if mismatches:
        raise RuntimeError('Post-apply checksum mismatch: ' + ', '.join(mismatches))
    print(f'OK: {len(paths)} files ' + ('restored.' if args.reverse else 'applied and verified.'))
    print('No commit, push, merge, or publication was performed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
