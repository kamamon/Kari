#!/usr/bin/env bash
# 本番ビルドを gh-pages ブランチへ置く（GitHub Pages の配信元）。
# 使い方: npm run publish:pages   （main をコミット・push した後に実行する）
# 履歴を上書きせず、前回の公開の上に 1 コミット積む。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "未コミットの変更があります。先にコミットしてください（ビルド番号がコミットと食い違うため）。" >&2
  exit 1
fi

npm run build
sha=$(git rev-parse --short HEAD)
touch dist/.nojekyll # Jekyll の処理を通さず、ファイルをそのまま配る

idx=$(mktemp -u)
GIT_INDEX_FILE="$idx" git --work-tree=dist add -A -f .
tree=$(GIT_INDEX_FILE="$idx" git write-tree)
rm -f "$idx"

parent=()
if git fetch -q --depth=1 origin gh-pages 2>/dev/null; then
  parent=(-p "$(git rev-parse FETCH_HEAD)")
fi
message="publish ${sha}"
if [ -n "${PUBLISH_TRAILER:-}" ]; then message="${message}"$'\n\n'"${PUBLISH_TRAILER}"; fi
name=$(git config user.name || echo "publisher")
email=$(git config user.email || echo "publisher@users.noreply.github.com")
commit=$(GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" git commit-tree "$tree" "${parent[@]}" -m "$message")
git push origin "${commit}:refs/heads/gh-pages"
echo "gh-pages を ${sha} の内容で更新しました（${commit}）"
