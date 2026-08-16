"""Tests for the Search Console fetcher — network-free via fixture service."""

import pytest
from unittest.mock import MagicMock

from scripts.analytics.providers.search_console import fetch


def _fixture_service(totals=None, queries=None, pages=None):
    """Build a mock searchconsole service returning fixture data."""
    if totals is None:
        totals = {"rows": [{"clicks": 850, "impressions": 12000, "ctr": 0.0708, "position": 8.3}]}
    if queries is None:
        queries = {
            "rows": [
                {"keys": ["best tacos"], "clicks": 120, "impressions": 3000, "ctr": 0.04, "position": 5.2},
                {"keys": ["beach sunset"], "clicks": 80, "impressions": 2500, "ctr": 0.032, "position": 7.1},
                {"keys": ["local cafe"], "clicks": 50, "impressions": 1500, "ctr": 0.033, "position": 6.0},
            ]
        }
    if pages is None:
        pages = {
            "rows": [
                {"keys": ["https://example.com/food/tacos"], "clicks": 200, "impressions": 5000, "ctr": 0.04, "position": 4.5},
                {"keys": ["https://example.com/about"], "clicks": 100, "impressions": 3000, "ctr": 0.033, "position": 6.1},
            ]
        }

    service = MagicMock()
    sa = MagicMock()
    service.searchanalytics.return_value = sa

    call_count = [0]

    def mock_query(**kwargs):
        result = MagicMock()
        body = kwargs.get("body", {})
        dims = body.get("dimensions", [])
        if not dims:
            result.execute.return_value = totals
        elif dims == ["query"]:
            result.execute.return_value = queries
        elif dims == ["page"]:
            result.execute.return_value = pages
        else:
            result.execute.return_value = {"rows": []}
        return result

    sa.query = mock_query
    return service


class TestSearchConsoleSuccess:
    def test_success_shape(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        result = fetch(days=28, _service=_fixture_service())

        assert result["schemaVersion"] == 1
        assert result["source"] == "search-console"
        assert "fetchedAt" in result
        assert result["period"]["days"] == 28
        assert isinstance(result["period"]["start"], str)
        assert isinstance(result["period"]["end"], str)

    def test_summary_fields_are_numbers(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        result = fetch(days=28, _service=_fixture_service())

        for key, val in result["summary"].items():
            assert isinstance(val, (int, float)), f"summary.{key} is {type(val)}"

    def test_top_queries_descending_by_clicks(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        result = fetch(days=28, _service=_fixture_service())

        clicks = [q["clicks"] for q in result["topQueries"]]
        assert clicks == sorted(clicks, reverse=True)

    def test_top_pages_descending_by_clicks(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        result = fetch(days=28, _service=_fixture_service())

        clicks = [p["clicks"] for p in result["topPages"]]
        assert clicks == sorted(clicks, reverse=True)

    def test_capped_at_configured_limits(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        from scripts.analytics.schemas import CAPS

        big_queries = {
            "rows": [
                {"keys": [f"query-{i}"], "clicks": 100 - i, "impressions": 1000, "ctr": 0.1, "position": 5.0}
                for i in range(CAPS["sc_top_queries"] + 10)
            ]
        }
        result = fetch(days=28, _service=_fixture_service(queries=big_queries))
        assert len(result["topQueries"]) <= CAPS["sc_top_queries"]


class TestSearchConsoleCredentials:
    def test_missing_site_url(self, monkeypatch):
        with pytest.raises(EnvironmentError, match="SC_SITE_URL"):
            fetch(days=28, _service=_fixture_service())

    def test_missing_google_creds(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        with pytest.raises(EnvironmentError, match="GOOGLE_SERVICE_ACCOUNT_JSON.*GOOGLE_APPLICATION_CREDENTIALS"):
            fetch(days=28)

    def test_malformed_service_account_json(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{broken")
        with pytest.raises(ValueError, match="not valid JSON"):
            fetch(days=28)


class TestSearchConsoleErrors:
    def test_api_error_propagates(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        service = MagicMock()
        sa = MagicMock()
        service.searchanalytics.return_value = sa
        query_mock = MagicMock()
        query_mock.execute.side_effect = RuntimeError("403 Forbidden")
        sa.query.return_value = query_mock
        with pytest.raises(RuntimeError, match="403"):
            fetch(days=28, _service=service)

    def test_empty_totals_raises(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        with pytest.raises(ValueError, match="no data"):
            fetch(days=28, _service=_fixture_service(totals={"rows": []}))

    def test_numeric_string_rejected(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        bad_totals = {"rows": [{"clicks": "850", "impressions": 12000, "ctr": 0.07, "position": 8.0}]}
        with pytest.raises(ValueError, match="numeric string"):
            fetch(days=28, _service=_fixture_service(totals=bad_totals))

    def test_malformed_response_missing_rows(self, monkeypatch):
        monkeypatch.setenv("SC_SITE_URL", "sc-domain:example.com")
        with pytest.raises(ValueError, match="no data"):
            fetch(days=28, _service=_fixture_service(totals={}))
