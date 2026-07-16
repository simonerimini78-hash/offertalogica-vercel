#!/usr/bin/env python3
"""Compatibility wrapper for the single canonical ARERA catalog transformer."""
from pathlib import Path
import runpy


ROOT = Path(__file__).resolve().parents[2]
runpy.run_path(str(ROOT / "scripts" / "update-arera-menu.py"), run_name="__main__")
