"""The normalized analytics contract, asserted by both provider and orchestrator tests.

`NORMALIZED_SCHEMA` is the single declaration of what each output file must contain:
the exact summary key set, and for every array field its exact item key set with each
item field's JSON type. `assert_normalized` compares exact key sets, so a field dropped
from a fetcher fails here, and a field added without declaring it fails too.

Provider tests apply this to real `fetch()` output so a fetcher regression fails; the
orchestrator suite applies it to the files actually written to disk.
"""

from __future__ import annotations

import re

NUMBER = "number"
STRING = "string"

ISO_UTC_SECONDS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NORMALIZED_SCHEMA = {
    "ga4": {
        "file": "ga4.json",
        "summary": {
            "activeUsers": NUMBER,
            "newUsers": NUMBER,
            "pageViews": NUMBER,
            "sessions": NUMBER,
            "averageSessionDurationSeconds": NUMBER,
            "engagementRate": NUMBER,
        },
        "arrays": {
            "topPages": {
                "path": STRING,
                "title": STRING,
                "views": NUMBER,
                "activeUsers": NUMBER,
            },
            "trafficSources": {
                "sourceMedium": STRING,
                "sessions": NUMBER,
                "activeUsers": NUMBER,
            },
        },
    },
    "search-console": {
        "file": "search-console.json",
        "summary": {
            "clicks": NUMBER,
            "impressions": NUMBER,
            "ctr": NUMBER,
            "averagePosition": NUMBER,
        },
        "arrays": {
            "topQueries": {
                "query": STRING,
                "clicks": NUMBER,
                "impressions": NUMBER,
                "ctr": NUMBER,
                "position": NUMBER,
            },
            "topPages": {
                "url": STRING,
                "clicks": NUMBER,
                "impressions": NUMBER,
                "ctr": NUMBER,
                "position": NUMBER,
            },
        },
    },
    "cloudflare": {
        "file": "cloudflare.json",
        "summary": {
            "requests": NUMBER,
            "pageViews": NUMBER,
            "visits": NUMBER,
            "bytes": NUMBER,
            "threats": NUMBER,
        },
        "arrays": {
            "topCountries": {
                "country": STRING,
                "requests": NUMBER,
                "threats": NUMBER,
                "bytes": NUMBER,
            },
            "statusCodes": {
                "status": NUMBER,
                "requests": NUMBER,
            },
        },
    },
}


def assert_json_type(value, expected, where):
    """Assert a value's JSON type. A Python bool is never a valid number here."""
    if expected == NUMBER:
        assert not isinstance(value, bool), f"{where} is a boolean, not a number"
        assert isinstance(value, (int, float)), (
            f"{where} is {type(value).__name__}, not a number"
        )
    else:
        assert isinstance(value, str), f"{where} is {type(value).__name__}, not a string"


def assert_normalized(data, source, *, require_nonempty_arrays=True):
    """Assert one normalized payload against the full contract for its source."""
    spec = NORMALIZED_SCHEMA[source]
    where = spec["file"]

    assert data["schemaVersion"] == 1, f"{where} schemaVersion"
    assert data["source"] == source, f"{where} source"
    assert ISO_UTC_SECONDS.match(data["fetchedAt"]), (
        f"{where} fetchedAt '{data['fetchedAt']}' is not an ISO-8601 UTC timestamp"
    )

    period = data["period"]
    assert set(period.keys()) == {"start", "end", "days"}, f"{where} period keys"
    assert ISO_DATE.match(period["start"]), f"{where} period.start '{period['start']}'"
    assert ISO_DATE.match(period["end"]), f"{where} period.end '{period['end']}'"
    assert_json_type(period["days"], NUMBER, f"{where} period.days")

    assert set(data["summary"].keys()) == set(spec["summary"]), f"{where} summary keys"
    for key, expected in spec["summary"].items():
        assert_json_type(data["summary"][key], expected, f"{where} summary.{key}")

    assert set(data.keys()) == {
        "schemaVersion", "source", "fetchedAt", "period", "summary", *spec["arrays"]
    }, f"{where} top-level keys"

    for array_name, item_spec in spec["arrays"].items():
        items = data[array_name]
        assert isinstance(items, list), f"{where} {array_name} is not a list"
        if require_nonempty_arrays:
            assert items, (
                f"{where} {array_name} is empty, so it proves no item field contract"
            )
        for index, item in enumerate(items):
            assert set(item.keys()) == set(item_spec), f"{where} {array_name}[{index}] keys"
            for key, expected in item_spec.items():
                assert_json_type(item[key], expected, f"{where} {array_name}[{index}].{key}")
