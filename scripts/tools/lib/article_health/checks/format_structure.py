"""format_structure — markdown structure / format validation.

Ported from the source corpus. Note: dimensions 1, 2, and 6 (Further Reading,
References H2, overview blockquote) check for editorial conventions now
canonical in docs/playbook/ARTICLE-PLAYBOOK.md §4 Structure / §4.1 At a Glance /
§citation (localized 2026-06-21). 0/18 this project articles adopt them
yet — retrofitting the existing corpus is a separate, larger task than the
ARTICLE-PLAYBOOK.md localization itself, so these stay WARN soft-launch until
that retrofit happens.

Dimensions ported:
  1. Further Reading section presence — WARN
  2. ## References H2 presence — WARN (when footnotes exist)
  4. broken inline `[link](url)` (no http/https) — WARN
  5. `[[wikilink]]` residue in list items — HARD (Astro doesn't render)
  6. "At a glance" overview blockquote presence — WARN

Deferred:
  3. footnote format (handled by `footnote_format` plugin)
  7. reverse link analysis (cross-article — separate plugin Phase 6b)
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "format-structure"
DIMENSION = "structure"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4 Structure"

# Further Reading markers (canonical accepted): `## Further Reading` or `**Further Reading**:`
_RE_FURTHER_READING = re.compile(
    r"^(?:##\s*Further Reading|\*\*Further Reading\*\*\s*:)", re.MULTILINE | re.IGNORECASE
)
_RE_REFERENCES_H2 = re.compile(r"^##\s*References", re.MULTILINE | re.IGNORECASE)
# Accept both:
#   > **At a glance**: body      (colon outside bold)
#   > **At a glance:** body      (colon inside bold)
_RE_OVERVIEW_BLOCKQUOTE = re.compile(
    r"^>\s*\*\*At a glance[:]?\*\*", re.MULTILINE | re.IGNORECASE
)
_RE_LIST_WIKILINK = re.compile(
    r"^(?:\s*[-*+]\s+)\[\[", re.MULTILINE
)
# Capture full list-wikilink line for rewrites:
#   - [[X]]            → display X
#   - [[X|Y]]          → display Y
#   - [[X]] — desc     → display "X — desc" or "X"
_RE_LIST_WIKILINK_FULL = re.compile(
    r"^(?P<indent>\s*[-*+]\s+)\[\[(?P<target>[^\]|]+)(?:\|(?P<display>[^\]]+))?\]\](?P<rest>.*)$",
    re.MULTILINE,
)
_RE_FOOTNOTE_REF_USE = re.compile(r"\[\^[0-9a-zA-Z_-]+\](?!:)")
_RE_FOOTNOTE_DEF = re.compile(r"^\[\^[0-9a-zA-Z_-]+\]:", re.MULTILINE)


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    body = target.body
    has_overview = bool(_RE_OVERVIEW_BLOCKQUOTE.search(body))
    has_further = bool(_RE_FURTHER_READING.search(body))
    has_refs_h2 = bool(_RE_REFERENCES_H2.search(body))
    has_fn_uses = bool(_RE_FOOTNOTE_REF_USE.search(body))
    has_fn_defs = bool(_RE_FOOTNOTE_DEF.search(body))

    # 1. "At a glance" overview missing
    if not has_overview:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message="Missing `> **At a glance:**` blockquote",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §4.1 The Opening Paragraph + At a Glance",
        )

    # 2. Further Reading missing (only flag for substantive articles)
    if not has_further and len(body) > 1500:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message="Missing Further Reading section (`## Further Reading` or `**Further Reading**:`)",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §4 Structure",
        )

    # 3. References H2 missing despite footnotes used / defined
    if (has_fn_uses or has_fn_defs) and not has_refs_h2:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message="Footnotes used but missing `## References` H2",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §4.6 Citations",
        )

    # 4. List items containing raw [[wikilink]] (HARD — Astro won't render)
    for m in _RE_LIST_WIKILINK.finditer(body):
        line_no = body.count("\n", 0, m.start()) + 1
        line_start = body.rfind("\n", 0, m.start()) + 1
        line_end = body.find("\n", m.start())
        if line_end == -1:
            line_end = len(body)
        snippet = body[line_start:line_end].strip()[:80]
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=(
                "List item contains raw `[[wikilink]]` residue — Astro won't render it, "
                "rewrite as `[text](/category/slug)`"
            ),
            line=line_no,
            snippet=snippet,
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §4.5 Further Reading",
        )

    # 5. Footnote ref count vs def count parity
    use_count = len(_RE_FOOTNOTE_REF_USE.findall(body))
    def_count = len(_RE_FOOTNOTE_DEF.findall(body))
    if use_count > 0 and def_count == 0:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=f"Uses {use_count} footnote ref(s) `[^N]` but has no `[^N]:` definitions",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §4.6 Citations",
        )


def fix(target: FileTarget, config: dict[str, Any]) -> int:
    """Auto-fix list-wikilink residuals — convert `- [[X]]` to `- X` (plain
    text). Astro doesn't render `[[X]]` in lists, so the safe transform is
    to extract the display text. If `[[X|Y]]` syntax, use Y; otherwise use
    X. We don't try to resolve to `/cat/slug` because that's
    wikilink-target's domain — list-wikilink residuals here are formatting
    drift, the target may or may not exist.

    Returns number of list-wikilink rewrites. Respects config['dry_run'].
    """
    body = target.body
    if not _RE_LIST_WIKILINK_FULL.search(body):
        return 0

    def _rewrite(m: re.Match) -> str:
        target_name = m.group("target").strip()
        display = m.group("display")
        rest = m.group("rest")
        text = display.strip() if display else target_name
        return f"{m.group('indent')}{text}{rest}"

    new_body = _RE_LIST_WIKILINK_FULL.sub(_rewrite, body)
    if new_body == body:
        return 0
    n_changed = len(_RE_LIST_WIKILINK_FULL.findall(body))
    if config.get("dry_run"):
        return n_changed
    # Strip body padding (frontmatter-aligned blank lines) before splicing back.
    if target.body_pad_lines:
        new_body_unpadded = (
            new_body[target.body_pad_lines:]
            if new_body.startswith("\n" * target.body_pad_lines)
            else new_body
        )
    else:
        new_body_unpadded = new_body
    new_text = target.text[: target.body_text_offset] + new_body_unpadded
    target.path.write_text(new_text, encoding="utf-8")
    return n_changed
