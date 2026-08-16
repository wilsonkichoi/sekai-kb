"""Tests for the GA4 fetcher — network-free via fixture client."""

import json
import pytest
from unittest.mock import MagicMock

from scripts.analytics.providers.ga4 import fetch
from tests.analytics_fetch.normalized_schema import assert_normalized


def _make_metric_value(val):
    mv = MagicMock()
    mv.value = str(val)
    return mv


def _make_metric_header(name):
    h = MagicMock()
    h.name = name
    return h


def _make_row(dimensions=None, metrics=None):
    row = MagicMock()
    if dimensions:
        row.dimension_values = [MagicMock(value=d) for d in dimensions]
    row.metric_values = [_make_metric_value(m) for m in (metrics or [])]
    return row


def _fixture_client():
    """Build a mock BetaAnalyticsDataClient returning fixture data."""
    client = MagicMock()

    overall_resp = MagicMock()
    overall_resp.rows = [
        _make_row(metrics=[1200, 400, 5000, 2000, 145.5, 0.72])
    ]
    overall_resp.metric_headers = [
        _make_metric_header("activeUsers"),
        _make_metric_header("newUsers"),
        _make_metric_header("screenPageViews"),
        _make_metric_header("sessions"),
        _make_metric_header("averageSessionDuration"),
        _make_metric_header("engagementRate"),
    ]

    pages_resp = MagicMock()
    pages_resp.rows = [
        _make_row(dimensions=["/about", "About Us"], metrics=[500, 300]),
        _make_row(dimensions=["/food/tacos", "Tacos Guide"], metrics=[400, 250]),
        _make_row(dimensions=["/", "Home"], metrics=[300, 200]),
    ]

    sources_resp = MagicMock()
    sources_resp.rows = [
        _make_row(dimensions=["google / organic"], metrics=[1000, 800]),
        _make_row(dimensions=["(direct) / (none)"], metrics=[500, 400]),
    ]

    client.run_report = MagicMock(side_effect=[overall_resp, pages_resp, sources_resp])
    return client


class TestGa4Success:
    def test_success_shape(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())

        assert result["schemaVersion"] == 1
        assert result["source"] == "ga4"
        assert "fetchedAt" in result
        assert result["period"]["days"] == 7
        assert isinstance(result["period"]["start"], str)
        assert isinstance(result["period"]["end"], str)

    def test_summary_fields_are_numbers(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())

        for key, val in result["summary"].items():
            assert isinstance(val, (int, float)), f"summary.{key} is {type(val)}"

    def test_output_satisfies_the_normalized_contract(self, monkeypatch):
        """Every required field and JSON type of real fetcher output, arrays included."""
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())

        assert_normalized(result, "ga4")

    def test_top_pages_descending_order(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())

        views = [p["views"] for p in result["topPages"]]
        assert views == sorted(views, reverse=True)

    def test_traffic_sources_descending_order(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())

        sessions = [s["sessions"] for s in result["trafficSources"]]
        assert sessions == sorted(sessions, reverse=True)

    def test_top_pages_capped(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        from scripts.analytics.schemas import CAPS

        client = MagicMock()
        overall_resp = MagicMock()
        overall_resp.rows = [_make_row(metrics=[100, 50, 1000, 500, 60.0, 0.5])]
        overall_resp.metric_headers = [
            _make_metric_header("activeUsers"),
            _make_metric_header("newUsers"),
            _make_metric_header("screenPageViews"),
            _make_metric_header("sessions"),
            _make_metric_header("averageSessionDuration"),
            _make_metric_header("engagementRate"),
        ]

        pages_resp = MagicMock()
        pages_resp.rows = [
            _make_row(dimensions=[f"/page-{i}", f"Page {i}"], metrics=[100 - i, 50 - i])
            for i in range(CAPS["ga4_top_pages"] + 10)
        ]

        sources_resp = MagicMock()
        sources_resp.rows = []

        client.run_report = MagicMock(side_effect=[overall_resp, pages_resp, sources_resp])
        result = fetch(days=7, _client=client)
        assert len(result["topPages"]) <= CAPS["ga4_top_pages"]


class TestGa4Credentials:
    def test_missing_property_id(self, monkeypatch):
        with pytest.raises(EnvironmentError, match="GA4_PROPERTY_ID"):
            fetch(days=7, _client=_fixture_client())

    def test_missing_all_google_creds(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        with pytest.raises(EnvironmentError, match="GOOGLE_SERVICE_ACCOUNT_JSON.*GOOGLE_APPLICATION_CREDENTIALS"):
            fetch(days=7)

    def test_malformed_service_account_json(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "not json{{{")
        with pytest.raises(ValueError, match="not valid JSON"):
            fetch(days=7)


class TestGa4Errors:
    def test_api_error_propagates(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        client = MagicMock()
        client.run_report = MagicMock(side_effect=RuntimeError("Authentication failed"))
        with pytest.raises(RuntimeError, match="Authentication failed"):
            fetch(days=7, _client=client)

    def test_empty_response_raises(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        client = MagicMock()
        empty_resp = MagicMock()
        empty_resp.rows = []
        client.run_report = MagicMock(return_value=empty_resp)
        with pytest.raises(ValueError, match="no data"):
            fetch(days=7, _client=client)

    def test_numeric_string_in_response_rejected(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        client = MagicMock()

        overall_resp = MagicMock()
        row = MagicMock()
        mv = MagicMock()
        mv.value = "not_a_number"
        row.metric_values = [mv, mv, mv, mv, mv, mv]
        overall_resp.rows = [row]
        overall_resp.metric_headers = [
            _make_metric_header("activeUsers"),
            _make_metric_header("newUsers"),
            _make_metric_header("screenPageViews"),
            _make_metric_header("sessions"),
            _make_metric_header("averageSessionDuration"),
            _make_metric_header("engagementRate"),
        ]
        client.run_report = MagicMock(return_value=overall_resp)

        with pytest.raises(ValueError, match="non-numeric"):
            fetch(days=7, _client=client)


class TestGa4TrafficSourcesCap:
    def test_traffic_sources_capped(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        from scripts.analytics.schemas import CAPS

        client = MagicMock()
        overall_resp = MagicMock()
        overall_resp.rows = [_make_row(metrics=[100, 50, 1000, 500, 60.0, 0.5])]
        overall_resp.metric_headers = [
            _make_metric_header("activeUsers"),
            _make_metric_header("newUsers"),
            _make_metric_header("screenPageViews"),
            _make_metric_header("sessions"),
            _make_metric_header("averageSessionDuration"),
            _make_metric_header("engagementRate"),
        ]

        pages_resp = MagicMock()
        pages_resp.rows = []

        sources_resp = MagicMock()
        sources_resp.rows = [
            _make_row(dimensions=[f"source-{i} / medium"], metrics=[100 - i, 50 - i])
            for i in range(CAPS["ga4_traffic_sources"] + 10)
        ]

        client.run_report = MagicMock(side_effect=[overall_resp, pages_resp, sources_resp])
        result = fetch(days=7, _client=client)
        assert len(result["trafficSources"]) <= CAPS["ga4_traffic_sources"]

    def test_traffic_source_item_has_required_fields(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())
        for src in result["trafficSources"]:
            assert "sourceMedium" in src
            assert "sessions" in src
            assert "activeUsers" in src
            assert isinstance(src["sessions"], (int, float))
            assert isinstance(src["activeUsers"], (int, float))

    def test_top_page_item_has_required_fields(self, monkeypatch):
        monkeypatch.setenv("GA4_PROPERTY_ID", "123456789")
        result = fetch(days=7, _client=_fixture_client())
        for page in result["topPages"]:
            assert "path" in page
            assert "title" in page
            assert "views" in page
            assert "activeUsers" in page
            assert isinstance(page["views"], (int, float))
            assert isinstance(page["activeUsers"], (int, float))
