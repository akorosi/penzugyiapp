#!/usr/bin/env python3
"""A Lambda telepítőcsomag összeállítása: build/lambda/

A függőségeket a Lambda futtatókörnyezetére (Python 3.13, arm64 / Graviton)
töltjük le előre fordított wheel-ként, így a build bármilyen gépen (Windows,
macOS, Linux x86) működik, Docker és bash nélkül.

Használat:  python scripts/build_lambda.py   (vagy: make lambda)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "lambda"
APP_FILES = ["main.py", "auth.py", "lambda_handler.py", "db.py", "repository.py", "excel_parser.py", "categorize.py"]
# Rögzített időbélyeg → változatlan forrásnál változatlan zip-hash, így a
# Terraform nem telepíti újra fölöslegesen a függvényt.
FIXED_MTIME = 1577836800  # 2020-01-01T00:00:00Z


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    cmd = [
        sys.executable, "-m", "pip", "install",
        "--quiet", "--disable-pip-version-check",
        "--platform", "manylinux2014_aarch64",
        "--implementation", "cp",
        "--python-version", "3.13",
        "--only-binary=:all:",
        "--target", str(OUT),
        "-r", str(ROOT / "app" / "requirements.txt"),
    ]
    print("Függőségek letöltése a Lambda (Linux arm64, Python 3.13) környezetre…")
    if subprocess.run(cmd).returncode != 0:
        print("Hiba: a pip install nem sikerült.", file=sys.stderr)
        return 1

    for name in APP_FILES:
        shutil.copy2(ROOT / "app" / name, OUT / name)

    # Méretcsökkentés: a futáshoz nem szükséges fájlok
    for path in sorted(OUT.rglob("__pycache__"), reverse=True):
        shutil.rmtree(path, ignore_errors=True)
    shutil.rmtree(OUT / "bin", ignore_errors=True)

    for path in [OUT, *OUT.rglob("*")]:
        if not path.is_symlink():
            os.utime(path, (FIXED_MTIME, FIXED_MTIME))

    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"Lambda csomag kész: {OUT} ({size / 1024 / 1024:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
