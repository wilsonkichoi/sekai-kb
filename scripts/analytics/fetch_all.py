"""Analytics orchestrator — runs all three providers, writes atomically.

Exits 0 only when all three providers succeed. A single provider failure
produces its error on stderr, does not prevent the other providers from
completing, and causes exit code 1 after all providers have run.

A failed provider never leaves a malformed or half-written target file.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from . import schemas


def _write_atomic(path: Path, data: dict) -> None:
    """Write JSON atomically: write to a temp file in the same directory, then rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def run(*, days: int = 7) -> int:
    """Run all fetchers and return exit code (0 = all succeeded, 1 = at least one failed)."""
    from .providers import cloudflare, ga4, search_console

    providers = [
        ("ga4", ga4.fetch, {"days": days}),
        ("search-console", search_console.fetch, {"days": 28}),
        ("cloudflare", cloudflare.fetch, {"days": days}),
    ]

    failed = []

    for name, fetch_fn, kwargs in providers:
        try:
            data = fetch_fn(**kwargs)
            _write_atomic(schemas.OUTPUT_FILES[name], data)
            print(f"[analytics] {name}: OK", file=sys.stderr)
        except Exception as e:
            failed.append(name)
            print(f"[analytics] {name}: FAILED — {type(e).__name__}: {e}", file=sys.stderr)

    if failed:
        print(
            f"[analytics] {len(failed)}/{len(providers)} provider(s) failed: "
            + ", ".join(failed),
            file=sys.stderr,
        )
        return 1

    print(f"[analytics] All {len(providers)} providers succeeded.", file=sys.stderr)
    return 0


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Fetch analytics from all providers")
    parser.add_argument("--days", type=int, default=7, help="Days to fetch (default 7)")
    args = parser.parse_args()
    sys.exit(run(days=args.days))


if __name__ == "__main__":
    main()
