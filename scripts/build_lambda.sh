#!/usr/bin/env bash
# A Lambda telepítőcsomag összeállítása: build/lambda/
#
# A függőségeket a Lambda futtatókörnyezetére (Python 3.13, arm64 / Graviton)
# töltjük le előre fordított wheel-ként, így a build bármilyen gépen (macOS,
# Windows WSL, Linux x86) működik, Docker nélkül.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/build/lambda"
PYTHON="${PYTHON:-python3}"

rm -rf "$OUT"
mkdir -p "$OUT"

"$PYTHON" -m pip install \
  --quiet --disable-pip-version-check \
  --platform manylinux2014_aarch64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  --target "$OUT" \
  -r "$ROOT/app/requirements.txt"

# Alkalmazáskód (tesztek és helyi segédszkriptek nélkül)
for f in main.py lambda_handler.py db.py repository.py excel_parser.py categorize.py; do
  cp "$ROOT/app/$f" "$OUT/"
done

# Méretcsökkentés: a futáshoz nem szükséges fájlok
find "$OUT" -type d -name "__pycache__" -prune -exec rm -rf {} +
find "$OUT" -type d -name "tests" -path "*/site-packages/*" -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf "$OUT/bin"

# Determinisztikus időbélyegek → változatlan forrásnál változatlan zip-hash,
# így a Terraform nem telepíti újra fölöslegesen a függvényt.
find "$OUT" -exec touch -h -t 202001010000 {} +

echo "Lambda csomag kész: $OUT ($(du -sh "$OUT" | cut -f1))"
