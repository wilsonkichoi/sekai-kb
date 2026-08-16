"""Tests for the Cloudflare fetcher — network-free via fixture query function."""

import pytest

from scripts.analytics.providers.cloudflare import fetch


def _fixture_response():
    return {
        "viewer": {
            "zones": [
                {
                    "httpRequests1dGroups": [
                        {
                            "dimensions": {"date": "2026-08-15"},
                            "sum": {
                                "requests": 5000,
                                "pageViews": 2000,
                                "threats": 5,
                                "bytes": 50000000,
                                "countryMap": [
                                    {"clientCountryName": "United States", "requests": 3000, "threats": 2, "bytes": 30000000},
                                    {"clientCountryName": "Japan", "requests": 1500, "threats": 1, "bytes": 15000000},
                                    {"clientCountryName": "Germany", "requests": 500, "threats": 2, "bytes": 5000000},
                                ],
                                "responseStatusMap": [
                                    {"edgeResponseStatus": 200, "requests": 4500},
                                    {"edgeResponseStatus": 404, "requests": 300},
                                    {"edgeResponseStatus": 301, "requests": 150},
                                    {"edgeResponseStatus": 500, "requests": 50},
                                ],
                            },
                            "uniq": {"uniques": 1500},
                        },
                        {
                            "dimensions": {"date": "2026-08-14"},
                            "sum": {
                                "requests": 4000,
                                "pageViews": 1800,
                                "threats": 3,
                                "bytes": 40000000,
                                "countryMap": [
                                    {"clientCountryName": "United States", "requests": 2500, "threats": 1, "bytes": 25000000},
                                    {"clientCountryName": "Japan", "requests": 1000, "threats": 0, "bytes": 10000000},
                                ],
                                "responseStatusMap": [
                                    {"edgeResponseStatus": 200, "requests": 3700},
                                    {"edgeResponseStatus": 404, "requests": 200},
                                    {"edgeResponseStatus": 301, "requests": 100},
                                ],
                            },
                            "uniq": {"uniques": 1200},
                        },
                    ]
                }
            ]
        }
    }


class TestCloudflareSuccess:
    def test_success_shape(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        assert result["schemaVersion"] == 1
        assert result["source"] == "cloudflare"
        assert "fetchedAt" in result
        assert result["period"]["days"] == 7

    def test_summary_fields_are_numbers(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        for key, val in result["summary"].items():
            assert isinstance(val, (int, float)), f"summary.{key} is {type(val)}"

    def test_summary_aggregation(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        assert result["summary"]["requests"] == 9000
        assert result["summary"]["pageViews"] == 3800
        assert result["summary"]["visits"] == 2700
        assert result["summary"]["bytes"] == 90000000
        assert result["summary"]["threats"] == 8

    def test_top_countries_descending(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        requests = [c["requests"] for c in result["topCountries"]]
        assert requests == sorted(requests, reverse=True)

    def test_status_codes_descending(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        reqs = [s["requests"] for s in result["statusCodes"]]
        assert reqs == sorted(reqs, reverse=True)

    def test_capped_countries(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        from scripts.analytics.schemas import CAPS

        many_countries = _fixture_response()
        day = many_countries["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]
        day["countryMap"] = [
            {"clientCountryName": f"Country {i}", "requests": 100 - i, "threats": 0, "bytes": 1000}
            for i in range(CAPS["cf_top_countries"] + 10)
        ]
        result = fetch(days=7, _query_fn=lambda q, v: many_countries)
        assert len(result["topCountries"]) <= CAPS["cf_top_countries"]


class TestCloudflareCredentials:
    def test_missing_api_token(self, monkeypatch):
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        with pytest.raises(EnvironmentError, match="CF_API_TOKEN"):
            fetch(days=7)

    def test_missing_zone_id(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        with pytest.raises(EnvironmentError, match="CF_ZONE_ID"):
            fetch(days=7)


class TestCloudflareErrors:
    def test_api_error_propagates(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        def raise_error(q, v):
            raise RuntimeError("HTTP 403: Forbidden")

        with pytest.raises(RuntimeError, match="403"):
            fetch(days=7, _query_fn=raise_error)

    def test_empty_zones_raises(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        with pytest.raises(ValueError, match="no zone data"):
            fetch(days=7, _query_fn=lambda q, v: {"viewer": {"zones": []}})

    def test_no_traffic_data_raises(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        resp = {"viewer": {"zones": [{"httpRequests1dGroups": []}]}}
        with pytest.raises(ValueError, match="no traffic data"):
            fetch(days=7, _query_fn=lambda q, v: resp)

    def test_numeric_string_rejected(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["requests"] = "5000"
        with pytest.raises(ValueError, match="numeric string"):
            fetch(days=7, _query_fn=lambda q, v: bad)
