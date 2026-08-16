"""Tests for the Cloudflare fetcher — network-free via fixture query function."""

import pytest

from scripts.analytics.providers.cloudflare import fetch
from tests.analytics_fetch.normalized_schema import assert_normalized


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

    def test_output_satisfies_the_normalized_contract(self, monkeypatch):
        """Every required field and JSON type of real fetcher output, arrays included."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        result = fetch(days=7, _query_fn=lambda q, v: _fixture_response())

        assert_normalized(result, "cloudflare")

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

    def test_incomplete_day_missing_required_field_rejected(self, monkeypatch):
        """A day group with only 'requests' in sum (missing pageViews/bytes/threats) must fail."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        incomplete = {
            "viewer": {
                "zones": [{
                    "httpRequests1dGroups": [{
                        "dimensions": {"date": "2026-08-15"},
                        "sum": {"requests": 5000},
                        "uniq": {"uniques": 1500},
                    }]
                }]
            }
        }
        with pytest.raises(ValueError, match="missing required field"):
            fetch(days=7, _query_fn=lambda q, v: incomplete)

    def test_missing_sum_object_rejected(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        no_sum = {
            "viewer": {
                "zones": [{
                    "httpRequests1dGroups": [{
                        "dimensions": {"date": "2026-08-15"},
                        "uniq": {"uniques": 1500},
                    }]
                }]
            }
        }
        with pytest.raises(ValueError, match="missing required.*sum"):
            fetch(days=7, _query_fn=lambda q, v: no_sum)

    def test_incomplete_country_row_rejected(self, monkeypatch):
        """A country row with only clientCountryName and requests (missing threats/bytes)."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["countryMap"] = [
            {"clientCountryName": "US", "requests": 100}
        ]
        with pytest.raises(ValueError, match="Country row missing required field"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_incomplete_status_row_rejected(self, monkeypatch):
        """A status row with only edgeResponseStatus (missing requests)."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["responseStatusMap"] = [
            {"edgeResponseStatus": 200}
        ]
        with pytest.raises(ValueError, match="Status row missing required field"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_absent_country_map_rejected(self, monkeypatch):
        """A day with every summary metric but no countryMap must not report zero countries."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        for day in bad["viewer"]["zones"][0]["httpRequests1dGroups"]:
            del day["sum"]["countryMap"]
        with pytest.raises(ValueError, match="missing required field 'countryMap'"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_absent_response_status_map_rejected(self, monkeypatch):
        """Same for responseStatusMap: absence is an incomplete response, not empty traffic."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        for day in bad["viewer"]["zones"][0]["httpRequests1dGroups"]:
            del day["sum"]["responseStatusMap"]
        with pytest.raises(ValueError, match="missing required field 'responseStatusMap'"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_null_country_map_rejected(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["countryMap"] = None
        with pytest.raises(ValueError, match="'countryMap' is not a list"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_country_row_without_name_rejected(self, monkeypatch):
        """An unnamed country row must fail, never be aggregated under a placeholder name."""
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["countryMap"] = [
            {"requests": 100, "threats": 0, "bytes": 1000}
        ]
        with pytest.raises(ValueError, match="missing required field 'clientCountryName'"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_numeric_string_status_code_rejected(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["responseStatusMap"] = [
            {"edgeResponseStatus": "200", "requests": 100}
        ]
        with pytest.raises(ValueError, match="numeric string"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_boolean_in_numeric_field_rejected(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")

        bad = _fixture_response()
        bad["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["requests"] = True
        with pytest.raises(ValueError, match="boolean"):
            fetch(days=7, _query_fn=lambda q, v: bad)

    def test_status_codes_capped(self, monkeypatch):
        monkeypatch.setenv("CF_API_TOKEN", "test-token")
        monkeypatch.setenv("CF_ZONE_ID", "test-zone-id")
        from scripts.analytics.schemas import CAPS

        many_statuses = _fixture_response()
        many_statuses["viewer"]["zones"][0]["httpRequests1dGroups"][0]["sum"]["responseStatusMap"] = [
            {"edgeResponseStatus": 200 + i, "requests": 100 - i}
            for i in range(CAPS["cf_status_codes"] + 10)
        ]
        result = fetch(days=7, _query_fn=lambda q, v: many_statuses)
        assert len(result["statusCodes"]) <= CAPS["cf_status_codes"]
