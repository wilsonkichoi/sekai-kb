"""Tests for the format_structure plugin: overview blockquote, residual
wikilinks, footnote-definition coherence, References section."""

import textwrap

from lib.article_health import registry
from lib.article_health.checks import format_structure
from lib.article_health.loader import load_target
from lib.article_health.types import Severity

_CAT = "category: Nature\n"


def test_overview_blockquote_missing_warn(write_article):
    body = textwrap.dedent(
        """\
        ## Opening

        Body text
        """
    )
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    assert any("At a glance" in v.message for v in violations)


def test_overview_blockquote_present_passes(write_article):
    body = textwrap.dedent(
        """\
        > **At a glance**: article thesis

        ## Opening

        Body text
        """
    )
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    overview_warns = [v for v in violations if "At a glance" in v.message]
    assert overview_warns == []


def test_list_wikilink_residual_hard(write_article):
    body = textwrap.dedent(
        """\
        > **At a glance**: x

        ## Section

        - [[residual wikilink]]
        - normal bullet
        """
    )
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    hard = [v for v in violations if v.severity == Severity.HARD]
    assert any("[[wikilink]]" in v.message for v in hard)


def test_footnote_use_without_def_hard(write_article):
    body = textwrap.dedent(
        """\
        > **At a glance**: x

        Body uses[^1] but has no definition.
        """
    )
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    hard = [v for v in violations if v.severity == Severity.HARD]
    assert any("no `[^N]:` definitions" in v.message for v in hard)


def test_references_h2_required_when_footnotes_used(write_article):
    body = textwrap.dedent(
        """\
        > **At a glance**: x

        Body[^1].

        [^1]: [Source](https://e.com) — desc enough chars
        """
    )
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    refs_warns = [v for v in violations if "References" in v.message]
    assert len(refs_warns) == 1


def test_complete_structure_passes(write_article):
    body = textwrap.dedent(
        """\
        > **At a glance**: article thesis

        ## Section

        Body[^1].

        ## Further Reading

        - [Article A](/cat/a)

        ## References

        [^1]: [src](https://e.com) — desc enough chars
        """
    ) + "\n".join(["filler"] * 50)
    target = load_target(write_article(body, extra=_CAT))
    violations = list(format_structure.check(target, {}))
    # No structural issues expected
    assert violations == [], [v.message for v in violations]


def test_format_structure_registered():
    registry.reset_registry()
    assert "format-structure" in registry.discover_checks()
