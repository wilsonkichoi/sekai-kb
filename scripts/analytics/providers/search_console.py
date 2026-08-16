"""Search Console fetcher — produces normalized search-console.json."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..schemas import CAPS, SCHEMA_VERSION


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise EnvironmentError(f"Required environment variable {name} is not set")
    return val


def _load_credentials():
    from google.oauth2 import service_account

    json_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if json_str:
        try:
            info = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {e}") from e
        return service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"]
        )

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not cred_path:
        raise EnvironmentError(
            "Neither GOOGLE_SERVICE_ACCOUNT_JSON nor GOOGLE_APPLICATION_CREDENTIALS is set"
        )
    path = Path(cred_path).expanduser()
    if not path.exists():
        raise EnvironmentError(f"GOOGLE_APPLICATION_CREDENTIALS path does not exist: {path}")
    return service_account.Credentials.from_service_account_file(
        str(path), scopes=["https://www.googleapis.com/auth/webmasters.readonly"]
    )


def _validate_numeric(value: Any, field: str) -> int | float:
    if isinstance(value, str):
        raise ValueError(f"Field '{field}' is a numeric string '{value}', expected a number")
    if not isinstance(value, (int, float)):
        raise ValueError(f"Field '{field}' has type {type(value).__name__}, expected a number")
    return value


def _require_field(row: dict, key: str, context: str) -> Any:
    """Require a field to be present in a provider response row."""
    if key not in row:
        raise ValueError(f"Provider response missing required field '{key}' in {context}")
    return row[key]


def fetch(*, days: int = 28, _service=None) -> dict:
    """Fetch Search Console data and return normalized dict.

    Args:
        days: Number of days to query (ends 2 days ago due to SC data lag).
        _service: Optional pre-built searchconsole service for testing.
    """
    site_url = _require_env("SC_SITE_URL")

    if _service is None:
        from googleapiclient.discovery import build

        credentials = _load_credentials()
        _service = build("searchconsole", "v1", credentials=credentials, cache_discovery=False)

    end_date = (datetime.now(timezone.utc).date() - timedelta(days=2))
    start_date = end_date - timedelta(days=days - 1)

    def query_sc(dimensions, row_limit=500):
        body = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "dimensions": dimensions,
            "rowLimit": row_limit,
            "dataState": "all",
        }
        return _service.searchanalytics().query(siteUrl=site_url, body=body).execute()

    totals_raw = query_sc([], row_limit=1)
    queries_raw = query_sc(["query"], row_limit=CAPS["sc_top_queries"])
    pages_raw = query_sc(["page"], row_limit=CAPS["sc_top_pages"])

    totals_row = (totals_raw.get("rows") or [{}])[0] if totals_raw.get("rows") else {}
    if not totals_row:
        raise ValueError("Search Console returned no data for the requested period")

    clicks = _validate_numeric(_require_field(totals_row, "clicks", "totals"), "summary.clicks")
    impressions = _validate_numeric(_require_field(totals_row, "impressions", "totals"), "summary.impressions")
    ctr = _validate_numeric(_require_field(totals_row, "ctr", "totals"), "summary.ctr")
    position = _validate_numeric(_require_field(totals_row, "position", "totals"), "summary.averagePosition")

    summary = {
        "clicks": clicks,
        "impressions": impressions,
        "ctr": round(ctr, 4),
        "averagePosition": round(position, 2),
    }

    top_queries = []
    for r in queries_raw.get("rows", [])[:CAPS["sc_top_queries"]]:
        top_queries.append({
            "query": r["keys"][0],
            "clicks": _validate_numeric(_require_field(r, "clicks", "query row"), "topQueries.clicks"),
            "impressions": _validate_numeric(_require_field(r, "impressions", "query row"), "topQueries.impressions"),
            "ctr": round(_validate_numeric(_require_field(r, "ctr", "query row"), "topQueries.ctr"), 4),
            "position": round(_validate_numeric(_require_field(r, "position", "query row"), "topQueries.position"), 2),
        })

    top_pages = []
    for r in pages_raw.get("rows", [])[:CAPS["sc_top_pages"]]:
        top_pages.append({
            "url": r["keys"][0],
            "clicks": _validate_numeric(_require_field(r, "clicks", "page row"), "topPages.clicks"),
            "impressions": _validate_numeric(_require_field(r, "impressions", "page row"), "topPages.impressions"),
            "ctr": round(_validate_numeric(_require_field(r, "ctr", "page row"), "topPages.ctr"), 4),
            "position": round(_validate_numeric(_require_field(r, "position", "page row"), "topPages.position"), 2),
        })

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "search-console",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
            "days": days,
        },
        "summary": summary,
        "topQueries": top_queries,
        "topPages": top_pages,
    }
