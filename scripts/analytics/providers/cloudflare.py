"""Cloudflare fetcher — produces normalized cloudflare.json."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from ..schemas import CAPS, SCHEMA_VERSION


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise EnvironmentError(f"Required environment variable {name} is not set")
    return val


def _validate_numeric(value: Any, field: str) -> int | float:
    if isinstance(value, str):
        raise ValueError(f"Field '{field}' is a numeric string '{value}', expected a number")
    if not isinstance(value, (int, float)):
        raise ValueError(f"Field '{field}' has type {type(value).__name__}, expected a number")
    return value


def _graphql(token: str, query: str, variables: dict) -> dict:
    url = "https://api.cloudflare.com/client/v4/graphql"
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_str = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare API HTTP {e.code}: {body_str[:400]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Cloudflare API unreachable: {e.reason}") from e

    if data.get("errors"):
        raise RuntimeError(
            f"Cloudflare GraphQL errors: {json.dumps(data['errors'], ensure_ascii=False)[:500]}"
        )
    return data.get("data", {})


DAILY_QUERY = """
query DailyTraffic($zoneTag: String!, $start: String!, $end: String!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        filter: { date_geq: $start, date_leq: $end }
        limit: 31
        orderBy: [date_DESC]
      ) {
        dimensions { date }
        sum {
          requests
          pageViews
          threats
          bytes
          countryMap {
            clientCountryName
            requests
            threats
            bytes
          }
          responseStatusMap {
            edgeResponseStatus
            requests
          }
        }
        uniq { uniques }
      }
    }
  }
}
"""


def fetch(*, days: int = 7, _query_fn=None) -> dict:
    """Fetch Cloudflare analytics and return normalized dict.

    Args:
        days: Number of days to query.
        _query_fn: Optional function(query, variables) -> data dict for testing.
    """
    token = _require_env("CF_API_TOKEN")
    zone_id = _require_env("CF_ZONE_ID")

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=days - 1)

    variables = {
        "zoneTag": zone_id,
        "start": start_date.strftime("%Y-%m-%d"),
        "end": end_date.strftime("%Y-%m-%d"),
    }

    if _query_fn:
        data = _query_fn(DAILY_QUERY, variables)
    else:
        data = _graphql(token, DAILY_QUERY, variables)

    zones = data.get("viewer", {}).get("zones", [])
    if not zones:
        raise ValueError("Cloudflare returned no zone data; check CF_ZONE_ID")

    days_data = zones[0].get("httpRequests1dGroups", [])
    if not days_data:
        raise ValueError("Cloudflare returned no traffic data for the requested period")

    total_requests = 0
    total_page_views = 0
    total_visits = 0
    total_bytes = 0
    total_threats = 0
    countries: dict[str, dict] = {}
    statuses: dict[int, int] = {}

    for day in days_data:
        s = day.get("sum")
        if s is None:
            raise ValueError("Cloudflare day group missing required 'sum' object")
        uniq = day.get("uniq")
        if uniq is None:
            raise ValueError("Cloudflare day group missing required 'uniq' object")

        if "requests" not in s:
            raise ValueError("Cloudflare response missing required field 'requests' in sum")
        if "pageViews" not in s:
            raise ValueError("Cloudflare response missing required field 'pageViews' in sum")
        if "bytes" not in s:
            raise ValueError("Cloudflare response missing required field 'bytes' in sum")
        if "threats" not in s:
            raise ValueError("Cloudflare response missing required field 'threats' in sum")
        if "uniques" not in uniq:
            raise ValueError("Cloudflare response missing required field 'uniques' in uniq")

        total_requests += _validate_numeric(s["requests"], "requests")
        total_page_views += _validate_numeric(s["pageViews"], "pageViews")
        total_visits += _validate_numeric(uniq["uniques"], "visits")
        total_bytes += _validate_numeric(s["bytes"], "bytes")
        total_threats += _validate_numeric(s["threats"], "threats")

        for c in s.get("countryMap", []) or []:
            name = c.get("clientCountryName", "Unknown")
            if name not in countries:
                countries[name] = {"requests": 0, "threats": 0, "bytes": 0}
            countries[name]["requests"] += _validate_numeric(
                c.get("requests", 0), "country.requests"
            )
            countries[name]["threats"] += _validate_numeric(
                c.get("threats", 0), "country.threats"
            )
            countries[name]["bytes"] += _validate_numeric(c.get("bytes", 0), "country.bytes")

        for r in s.get("responseStatusMap", []) or []:
            code = r.get("edgeResponseStatus", 0)
            count = _validate_numeric(r.get("requests", 0), "status.requests")
            statuses[code] = statuses.get(code, 0) + count

    summary = {
        "requests": total_requests,
        "pageViews": total_page_views,
        "visits": total_visits,
        "bytes": total_bytes,
        "threats": total_threats,
    }

    top_countries = sorted(countries.items(), key=lambda x: x[1]["requests"], reverse=True)
    top_countries = [
        {
            "country": name,
            "requests": info["requests"],
            "threats": info["threats"],
            "bytes": info["bytes"],
        }
        for name, info in top_countries[: CAPS["cf_top_countries"]]
    ]

    status_codes = sorted(statuses.items(), key=lambda x: x[1], reverse=True)
    status_codes = [
        {"status": code, "requests": count}
        for code, count in status_codes[: CAPS["cf_status_codes"]]
    ]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "cloudflare",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
            "days": days,
        },
        "summary": summary,
        "topCountries": top_countries,
        "statusCodes": status_codes,
    }
