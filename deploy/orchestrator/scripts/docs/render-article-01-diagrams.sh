#!/usr/bin/env bash
# Regenerate SVG and PNG publication assets from the canonical Mermaid source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANON="$ROOT/docs/diagrams/article-01-experience-ingestion.mmd"
OUTDIR="$ROOT/docs/articles/companions/article-01-experience-ingestion/images"
BASE="article-01-experience-ingestion"

if [[ ! -f "$CANON" ]]; then
  echo "missing: $CANON" >&2
  exit 1
fi

mkdir -p "$OUTDIR"

npx --yes @mermaid-js/mermaid-cli@11 -i "$CANON" -o "$OUTDIR/${BASE}.svg" -q
npx --yes @mermaid-js/mermaid-cli@11 -i "$CANON" -o "$OUTDIR/${BASE}.png" -w 1800 -s 1 -b white -q

echo "wrote $OUTDIR/${BASE}.{svg,png} from $CANON"
