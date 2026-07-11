#!/usr/bin/env python3
"""check-article-health-baseline.py — assert article-health output matches the
committed fork baseline.

Runs `article-health --all --profile=release-pr` over `knowledge/` and compares
the per-article hard/warn/info counts against the table in
`docs/baselines/article-health-fork.md` (task 4.1 parity target). Exits non-zero
on any drift, so it can guard regressions once wired into CI/pre-commit ([4.1b]).

Usage:  uv run python scripts/tools/check-article-health-baseline.py
        (run from the repo root)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

_THIS = Path(__file__).resolve()
_REPO_ROOT = _THIS.parents[2]
_TOOL = _THIS.parent / "article-health.py"
_BASELINE = _REPO_ROOT / "docs" / "baselines" / "article-health-fork.md"

# Baseline table row: | slug | Category | Hard | Warn | Info | Pass |
_ROW = re.compile(
    r"^\|\s*([a-z0-9-]+)\s*\|[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|[^|]*\|"
)


def _parse_baseline(path: Path) -> dict[str, tuple[int, int, int]]:
    expected: dict[str, tuple[int, int, int]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = _ROW.match(line)
        if not m:
            continue
        slug, hard, warn, info = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))
        expected[slug] = (hard, warn, info)
    return expected


def _run_tool() -> dict[str, tuple[int, int, int]]:
    out = subprocess.run(
        [sys.executable, str(_TOOL), "--all", "--output=json", "--profile=release-pr"],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
    )
    # release-pr uses fail_on=warn, so a non-zero exit is expected when warnings
    # exist; we only need the JSON payload on stdout.
    payload = json.loads(out.stdout)
    actual: dict[str, tuple[int, int, int]] = {}
    for report in payload["reports"]:
        s = report["summary"]
        actual[report["slug"]] = (s["hard"], s["warn"], s["info"])
    return actual


def main() -> int:
    if not _BASELINE.exists():
        print(f"baseline not found: {_BASELINE}", file=sys.stderr)
        return 2
    expected = _parse_baseline(_BASELINE)
    actual = _run_tool()

    problems: list[str] = []
    for slug, exp in sorted(expected.items()):
        act = actual.get(slug)
        if act is None:
            problems.append(f"  {slug}: in baseline but not produced by the tool")
        elif act != exp:
            problems.append(
                f"  {slug}: expected hard/warn/info {exp}, got {act}"
            )
    for slug in sorted(set(actual) - set(expected)):
        problems.append(f"  {slug}: produced by the tool but not in baseline")

    total_hard = sum(v[0] for v in actual.values())
    if total_hard:
        problems.append(f"  total hard violations: {total_hard} (baseline requires 0)")

    if problems:
        print("❌ article-health baseline parity FAILED:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1

    print(
        f"✓ article-health baseline parity — {len(actual)} articles match "
        f"{_BASELINE.relative_to(_REPO_ROOT)} (0 hard)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
