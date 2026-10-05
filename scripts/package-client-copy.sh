#!/usr/bin/env bash
# Package a clean, copy-ready OMS source tree for a client.
#
#   bash scripts/package-client-copy.sh [git-ref] [output-dir]
#
# Defaults: ref = main, output-dir = ../OMS-packages (next to the project).
#
# Built with `git archive`, so the package contains tracked files only — never
# .env files, node_modules, tmp/, local databases or backups. Internal QA
# evidence is excluded via .gitattributes (export-ignore). The recipient copies
# .env.example -> .env (and apps/*/.env.example) and fills in their own values.
set -euo pipefail

ref="${1:-main}"
out_dir="${2:-../OMS-packages}"

cd "$(git rev-parse --show-toplevel)"
sha="$(git rev-parse --short "$ref")"
mkdir -p "$out_dir"
out="$out_dir/OMS-${sha}.zip"

git archive --format=zip --prefix=OMS/ -o "$out" "$ref"
echo "Created $out ($(du -h "$out" | cut -f1)) from $ref @ $sha"
