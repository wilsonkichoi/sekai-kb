"""Tests for the wikilink_target plugin: [[X]] must resolve to a knowledge article."""

from lib.article_health import registry
from lib.article_health.checks import wikilink_target
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def test_wikilink_resolves(write_article, monkeypatch, tmp_path):
    """[[X]] → if 'knowledge/<cat>/X.md' exists, no violation."""
    monkeypatch.chdir(tmp_path)
    write_article("target body", name="Tawny Fish Owl.md")
    wikilink_target._reset_cache()
    src = write_article("See [[Tawny Fish Owl]] for more", name="x.md")
    target = load_target(src)
    assert list(wikilink_target.check(target, {})) == []


def test_wikilink_target_missing_flagged(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    wikilink_target._reset_cache()
    src = write_article("See [[Nonexistent Target]] later", name="x.md")
    target = load_target(src)
    violations = list(wikilink_target.check(target, {}))
    assert len(violations) == 1
    assert violations[0].severity == Severity.HARD
    assert "Nonexistent Target" in violations[0].message


def test_wikilink_with_alias(write_article, monkeypatch, tmp_path):
    """[[X|display text]] — target X must resolve."""
    monkeypatch.chdir(tmp_path)
    write_article("target body", name="Black Bear.md")
    wikilink_target._reset_cache()
    src = write_article("See [[Black Bear|black bears]] here", name="x.md")
    target = load_target(src)
    assert list(wikilink_target.check(target, {})) == []


def test_wikilink_target_registered():
    registry.reset_registry()
    assert "wikilink-target" in registry.discover_checks()
