#!/usr/bin/env python3
"""Kari 11武器統合の候補を隔離 worktree で適用。公開 main を書き換えない。"""
import argparse
import pathlib
import shutil
import subprocess
import sys

BASE = '56578c6917ae1d958052c38db85fcd9707b5e336'
SOURCE = pathlib.Path(__file__).resolve().parent / 'overlay'

def git(root, *args, check=True):
    return subprocess.run(['git','-C',str(root),*args],check=check,capture_output=True,text=True)

def run(root, *cmd):
    print('+', ' '.join(cmd),flush=True)
    subprocess.run(cmd,cwd=root,check=True)

def blob(root, ref, name):
    r = git(root,'rev-parse','--verify',ref+':'+name,check=False)
    return r.stdout.strip() if r.returncode==0 else None

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target',default='.')
    p.add_argument('--build',action='store_true',help='別worktreeで適用し、全テストとビルドを実行')
    p.add_argument('--worktree')
    p.add_argument('--branch',default='integration/11-weapons-20261127')
    p.add_argument('--commit',action='store_true',help='全検査合格後だけ隔離ブランチにコミット')
    args=p.parse_args()
    root=pathlib.Path(git(pathlib.Path(args.target).resolve(),'rev-parse','--show-toplevel').stdout.strip())
    git(root,'cat-file','-e',BASE+'^{commit}')
    head=git(root,'rev-parse','HEAD').stdout.strip()
    paths=sorted(x.relative_to(SOURCE).as_posix() for x in SOURCE.rglob('*') if x.is_file())
    conflicts=[]
    for name in paths:
        before=blob(root,BASE,name)
        current=blob(root,head,name)
        if current!=before:
            conflicts.append(name)
        dest=root/name
        if dest.exists() and not current: conflicts.append(name+' (untracked)')
    if conflicts:
        print('STOP: 対象の変更を先に照合してください:\n'+'\n'.join(sorted(set(conflicts))))
        return 2
    print('PASS: '+str(len(paths))+' overlay files; base blobs unchanged.')
    if not args.build:
        print('確認のみ。--build で隔離適用・検査。')
        return 0
    if git(root,'status','--porcelain').stdout.strip():
        print('STOP: working tree must be clean.'); return 2
    dest=pathlib.Path(args.worktree).resolve() if args.worktree else root.parent/'kari-11-integration'
    if dest.exists():
        print('STOP: worktree already exists: '+str(dest)); return 2
    if args.branch=='main' or args.branch=='master':
        print('STOP: use an integration branch.'); return 2
    run(root,'git','worktree','add','-b',args.branch,str(dest),head)
    for name in paths:
        out=dest/name
        out.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(SOURCE/name,out)
    try:
        run(dest,'npm','ci')
        run(dest,'node','--experimental-strip-types','--no-warnings','tools/gen-weapons.mjs','--strict')
        run(dest,'npm','run','check')
    except subprocess.CalledProcessError:
        print('FAIL: 未合格。隔離worktreeを修正し再検査してください: '+str(dest))
        return 1
    run(dest,'git','status','--short')
    if args.commit:
        run(dest,'git','add','-A')
        run(dest,'git','commit','-m','Add four weapon families and generated combat motions')
    print('PASS: isolated candidate; no merge/push. '+str(dest))
    return 0

if __name__=='__main__':
    sys.exit(main())
