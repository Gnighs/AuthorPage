#!/usr/bin/env python3
import runpy
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
runpy.run_path(str(PROJECT_ROOT / "tools" / "generate_site.py"), run_name="__main__")
