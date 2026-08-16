"""Tests for the analytics orchestrator — partial failure, atomic writes, no credentials in output."""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from scripts.analytics.fetch_all import run, _write_atomic
from scripts.analytics import schemas
from tests.analytics_fetch.normalized_schema import NORMALIZED_SCHEMA, assert_normalized


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
        "topPages": [{"url": "/food/tacos", "clicks": 200, "impressions": 5000, "ctr": 0.04, "position": 4.5}],
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

    def test_stderr_redacts_credentials_on_failure(self, monkeypatch, output_dir, capsys):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        monkeypatch.setenv("GA4_PROPERTY_ID", "PROP-SECRET-999")
        monkeypatch.setenv("CF_API_TOKEN", "cf-token-secret-xyz")
        monkeypatch.setenv("CF_ZONE_ID", "zone-secret-abc")
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:secret-site.test")

        with patch("scripts.analytics.providers.ga4.fetch",
                   side_effect=RuntimeError("Auth failed for property PROP-SECRET-999")), \
             patch("scripts.analytics.providers.search_console.fetch",
                   side_effect=RuntimeError("Cannot access sc-domain:secret-site.test")), \
             patch("scripts.analytics.providers.cloudflare.fetch",
                   side_effect=RuntimeError("Token cf-token-secret-xyz rejected for zone zone-secret-abc")):
            run(days=7)

        captured = capsys.readouterr()
        assert "PROP-SECRET-999" not in captured.err
        assert "cf-token-secret-xyz" not in captured.err
        assert "zone-secret-abc" not in captured.err
        assert "sc-domain:secret-site.test" not in captured.err
        assert "[REDACTED:" in captured.err

    def test_stderr_redacts_service_account_fields(self, monkeypatch, output_dir, capsys):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        import json as json_mod
        sa_json = json_mod.dumps({
            "client_email": "planted@example.invalid",
            "private_key_id": "planted-key-id-abc123",
            "project_id": "planted-project",
        })
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", sa_json)
        monkeypatch.setenv("GA4_PROPERTY_ID", "12345")
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:x.test")
        monkeypatch.setenv("CF_API_TOKEN", "tok")
        monkeypatch.setenv("CF_ZONE_ID", "zone")

        with patch("scripts.analytics.providers.ga4.fetch",
                   side_effect=RuntimeError("Error for planted@example.invalid with key planted-key-id-abc123")), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            run(days=7)

        captured = capsys.readouterr()
        assert "planted@example.invalid" not in captured.err
        assert "planted-key-id-abc123" not in captured.err

    @pytest.mark.parametrize("sa_value", ["[]", '"a string"', "null", "17", "not json at all"])
    def test_non_object_service_account_json_does_not_abort_the_run(
        self, monkeypatch, output_dir, capsys, sa_value
    ):
        """Redaction must never become a second failure source.

        A GOOGLE_SERVICE_ACCOUNT_JSON that is not a JSON object still has to leave the
        remaining providers able to write their valid outputs, and the run still exits 1.
        """
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", sa_value)

        with patch("scripts.analytics.providers.ga4.fetch",
                   side_effect=RuntimeError("credential load failed")), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            code = run(days=7)

        assert code == 1
        assert not (output_dir / "ga4.json").exists()
        assert (output_dir / "search-console.json").exists()
        assert (output_dir / "cloudflare.json").exists()
        assert "credential load failed" in capsys.readouterr().err

    def test_stderr_redacts_credentials_file_service_account_fields(
        self, monkeypatch, output_dir, tmp_path, capsys
    ):
        """GOOGLE_APPLICATION_CREDENTIALS names a service-account file; its values leak too."""
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        cred_file = tmp_path / "service-account.json"
        cred_file.write_text(json.dumps({
            "client_email": "planted-file@example.invalid",
            "private_key_id": "planted-file-key-id",
            "project_id": "planted-file-project",
        }))
        monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(cred_file))

        with patch("scripts.analytics.providers.ga4.fetch",
                   side_effect=RuntimeError(
                       "JWT for planted-file@example.invalid "
                       "(key planted-file-key-id, project planted-file-project) rejected"
                   )), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            run(days=7)

        captured = capsys.readouterr()
        assert "planted-file@example.invalid" not in captured.err
        assert "planted-file-key-id" not in captured.err
        assert "planted-file-project" not in captured.err

    def test_unreadable_credentials_file_does_not_abort_the_run(
        self, monkeypatch, output_dir, tmp_path, capsys
    ):
        """A path that does not exist is a provider error, never a redaction crash."""
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })

        monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(tmp_path / "absent.json"))

        with patch("scripts.analytics.providers.ga4.fetch",
                   side_effect=RuntimeError("credentials path does not exist")), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=_sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=_cf_fixture()):
            code = run(days=7)

        assert code == 1
        assert (output_dir / "search-console.json").exists()
        assert (output_dir / "cloudflare.json").exists()


class TestSchemaValidation:
    """Validates required fields, ISO timestamps, and period structure."""

    def _run_and_read(self, monkeypatch, output_dir, ga4=None, sc=None, cf=None):
        monkeypatch.setattr(schemas, "OUTPUT_DIR", output_dir)
        monkeypatch.setattr(schemas, "OUTPUT_FILES", {
            "ga4": output_dir / "ga4.json",
            "search-console": output_dir / "search-console.json",
            "cloudflare": output_dir / "cloudflare.json",
        })
        with patch("scripts.analytics.providers.ga4.fetch", return_value=ga4 or _ga4_fixture()), \
             patch("scripts.analytics.providers.search_console.fetch", return_value=sc or _sc_fixture()), \
             patch("scripts.analytics.providers.cloudflare.fetch", return_value=cf or _cf_fixture()):
            run(days=7)
        results = {}
        for name in ("ga4.json", "search-console.json", "cloudflare.json"):
            path = output_dir / name
            if path.exists():
                results[name] = json.loads(path.read_text())
        return results

    def test_all_files_have_required_envelope(self, monkeypatch, output_dir):
        results = self._run_and_read(monkeypatch, output_dir)
        for name, data in results.items():
            assert data["schemaVersion"] == 1, f"{name} schemaVersion"
            assert "source" in data, f"{name} missing source"
            assert "fetchedAt" in data, f"{name} missing fetchedAt"
            assert "period" in data, f"{name} missing period"

    def test_fetched_at_is_iso_format(self, monkeypatch, output_dir):
        import re
        results = self._run_and_read(monkeypatch, output_dir)
        iso_re = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        for name, data in results.items():
            assert iso_re.match(data["fetchedAt"]), (
                f"{name} fetchedAt '{data['fetchedAt']}' is not ISO-8601"
            )

    def test_period_has_required_fields(self, monkeypatch, output_dir):
        results = self._run_and_read(monkeypatch, output_dir)
        for name, data in results.items():
            period = data["period"]
            assert "start" in period, f"{name} period missing start"
            assert "end" in period, f"{name} period missing end"
            assert "days" in period, f"{name} period missing days"
            assert isinstance(period["days"], int), f"{name} period.days not int"

    def test_written_files_satisfy_the_full_normalized_contract(self, monkeypatch, output_dir):
        """Every required field, exact key sets, and every JSON type, on disk."""
        results = self._run_and_read(monkeypatch, output_dir)
        for source, spec in NORMALIZED_SCHEMA.items():
            assert_normalized(results[spec["file"]], source)
