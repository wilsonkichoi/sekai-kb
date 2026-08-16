"""Tests for the analytics orchestrator — partial failure, atomic writes, no credentials in output."""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from scripts.analytics.fetch_all import run, _write_atomic
from scripts.analytics import schemas


def _ga4_fixture():
    return {
        "schemaVersion": 1,
        "source": "ga4",
        "fetchedAt": "2026-08-15T10:00:00Z",
        "period": {"start": "2026-08-09", "end": "2026-08-15", "days": 7},
        "summary": {"activeUsers": 1200, "newUsers": 400, "pageViews": 5000,
                    "sessions": 2000, "averageSessionDurationSeconds": 145.5,
                    "engagementRate": 0.72},
        "topPages": [{"path": "/about", "title": "About", "views": 500, "activeUsers": 300}],
        "trafficSources": [{"sourceMedium": "google / organic", "sessions": 1000, "activeUsers": 800}],
    }


def _sc_fixture():
    return {
        "schemaVersion": 1,
        "source": "search-console",
        "fetchedAt": "2026-08-15T10:00:00Z",
        "period": {"start": "2026-07-17", "end": "2026-08-13", "days": 28},
        "summary": {"clicks": 850, "impressions": 12000, "ctr": 0.0708, "averagePosition": 8.3},
        "topQueries": [{"query": "tacos", "clicks": 120, "impressions": 3000, "ctr": 0.04, "position": 5.2}],
        "topPages": [{"url": "https://example.com/food/tacos", "clicks": 200, "impressions": 5000, "ctr": 0.04, "position": 4.5}],
    }


def _cf_fixture():
    return {
        "schemaVersion": 1,
        "source": "cloudflare",
        "fetchedAt": "2026-08-15T10:00:00Z",
        "period": {"start": "2026-08-09", "end": "2026-08-15", "days": 7},
        "summary": {"requests": 9000, "pageViews": 3800, "visits": 2700, "bytes": 90000000, "threats": 8},
        "topCountries": [{"country": "United States", "requests": 5500, "threats": 3, "bytes": 55000000}],
        "statusCodes": [{"status": 200, "requests": 8200}],
    }


class TestOrchestratorAllSuccess:
    def test_all_succeed_exit_zero(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        with patch("scripts.analytics.providers.ga4.fetch", return_value=_ga4_fixture()), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            code = run(days=7)

        assert code == 0
        assert (output_dir / "ga4.json").exists()
        assert (output_dir / "search-console.json").exists()
        assert (output_dir / "cloudflare.json").exists()

    def test_output_json_valid(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        with patch("scripts.analytics.providers.ga4.fetch", return_value=_ga4_fixture()), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            run(days=7)

        for name in ("ga4.json", "search-console.json", "cloudflare.json"):
            data = json.loads((output_dir / name).read_text())
            assert data["schemaVersion"] == 1
            assert "fetchedAt" in data
            assert "period" in data


class TestOrchestratorPartialFailure:
    def test_one_failure_others_succeed(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        with patch("scripts.analytics.providers.ga4.fetch", side_effect=RuntimeError("Auth failed")), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            code = run(days=7)

        assert code == 1
        assert not (output_dir / "ga4.json").exists()
        assert (output_dir / "search-console.json").exists()
        assert (output_dir / "cloudflare.json").exists()

    def test_all_fail_exit_nonzero(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        with patch("scripts.analytics.providers.ga4.fetch", side_effect=RuntimeError("fail")), \
             patch("scripts.analytics.providers.search_console.fetch", side_effect=RuntimeError("fail")), \
             patch("scripts.analytics.providers.cloudflare.fetch", side_effect=RuntimeError("fail")):
            code = run(days=7)

        assert code == 1
        assert not (output_dir / "ga4.json").exists()
        assert not (output_dir / "search-console.json").exists()
        assert not (output_dir / "cloudflare.json").exists()


class TestAtomicReplacement:
    def test_successful_write_replaces_existing(self, tmp_path):
        target = tmp_path / "test.json"
        target.write_text('{"old": true}')
        _write_atomic(target, {"new": True})
        assert json.loads(target.read_text()) == {"new": True}

    def test_failed_fetch_preserves_existing_file(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        output_dir.mkdir(parents=True, exist_ok=True)
        existing = output_dir / "ga4.json"
        existing.write_text('{"schemaVersion": 1, "old": true}')

        with patch("scripts.analytics.providers.ga4.fetch", side_effect=RuntimeError("fail")), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            run(days=7)

        data = json.loads(existing.read_text())
        assert data.get("old") is True


class TestNoCredentialsInOutput:
    def test_output_contains_no_secrets(self, monkeypatch, output_dir):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        secrets = {
            "GA4_PROPERTY_ID": "123456789",
            "SC_SITE_URL": "sc-domain:secret-site.example.com",
            "CF_API_TOKEN": "super-secret-token-12345",
            "CF_ZONE_ID": "zone-id-abcdef123456",
        }

        ga4 = _ga4_fixture()
        sc = _sc_fixture()
        cf = _cf_fixture()

        with patch("scripts.analytics.providers.ga4.fetch", return_value=ga4), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=sc), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=cf):
            run(days=7)

        for name in ("ga4.json", "search-console.json", "cloudflare.json"):
            content = (output_dir / name).read_text()
            for secret_name, secret_val in secrets.items():
                assert secret_val not in content, (
                    f"{secret_name} value found in {name}"
                )
