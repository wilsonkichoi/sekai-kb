"""GA4 fetcher — produces normalized ga4.json."""

from __future__ import annotations

import json
import os
import sys
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
        return service_account.Credentials.from_service_account_info(info)

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not cred_path:
        raise EnvironmentError(
            "Neither GOOGLE_SERVICE_ACCOUNT_JSON nor GOOGLE_APPLICATION_CREDENTIALS is set"
        )
    path = Path(cred_path).expanduser()
    if not path.exists():
        raise EnvironmentError(f"GOOGLE_APPLICATION_CREDENTIALS path does not exist: {path}")
    return service_account.Credentials.from_service_account_file(str(path))


def _validate_numeric(value: Any, field: str) -> int | float:
    """Reject numeric strings and booleans; accept only real numbers."""
    if isinstance(value, bool):
        raise ValueError(f"Field '{field}' is a boolean, expected a number")
    if isinstance(value, str):
        raise ValueError(f"Field '{field}' is a numeric string '{value}', expected a number")
    if not isinstance(value, (int, float)):
        raise ValueError(f"Field '{field}' has type {type(value).__name__}, expected a number")
    return value


def _parse_metric(raw: str, field: str) -> int | float:
    """Parse a GA4 API metric value (always returned as string) into a number."""
    if not isinstance(raw, str):
        return _validate_numeric(raw, field)
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        raise ValueError(f"Field '{field}' has non-numeric value '{raw}'") from None


def fetch(*, days: int = 7, _client=None) -> dict:
    """Fetch GA4 data and return normalized dict.

    Args:
        days: Number of days to query.
        _client: Optional pre-built BetaAnalyticsDataClient for testing.
    """
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import (
        DateRange,
        Dimension,
        Metric,
        OrderBy,
        RunReportRequest,
    )

    property_id = _require_env("GA4_PROPERTY_ID")

    if _client is None:
        credentials = _load_credentials()
        _client = BetaAnalyticsDataClient(credentials=credentials)

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=days - 1)

    date_range = DateRange(
        start_date=start_date.strftime("%Y-%m-%d"),
        end_date=end_date.strftime("%Y-%m-%d"),
    )

    overall_req = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[date_range],
        metrics=[
            Metric(name="activeUsers"),
            Metric(name="newUsers"),
            Metric(name="screenPageViews"),
            Metric(name="sessions"),
            Metric(name="averageSessionDuration"),
            Metric(name="engagementRate"),
        ],
    )

    pages_req = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[date_range],
        dimensions=[Dimension(name="pagePath"), Dimension(name="pageTitle")],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="activeUsers"),
        ],
        order_bys=[
            OrderBy(metric=OrderBy.MetricOrderBy(metric_name="screenPageViews"), desc=True)
        ],
        limit=CAPS["ga4_top_pages"],
    )

    sources_req = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[date_range],
        dimensions=[Dimension(name="sessionSourceMedium")],
        metrics=[Metric(name="sessions"), Metric(name="activeUsers")],
        order_bys=[
            OrderBy(metric=OrderBy.MetricOrderBy(metric_name="sessions"), desc=True)
        ],
        limit=CAPS["ga4_traffic_sources"],
    )

    overall = _client.run_report(overall_req)
    pages = _client.run_report(pages_req)
    sources = _client.run_report(sources_req)

    if not overall.rows:
        raise ValueError("GA4 returned no data for the requested period")

    row = overall.rows[0]
    metric_map = {h.name: row.metric_values[i].value for i, h in enumerate(overall.metric_headers)}

    summary = {
        "activeUsers": _parse_metric(metric_map["activeUsers"], "activeUsers"),
        "newUsers": _parse_metric(metric_map["newUsers"], "newUsers"),
        "pageViews": _parse_metric(metric_map["screenPageViews"], "pageViews"),
        "sessions": _parse_metric(metric_map["sessions"], "sessions"),
        "averageSessionDurationSeconds": _parse_metric(
            metric_map["averageSessionDuration"], "averageSessionDurationSeconds"
        ),
        "engagementRate": _parse_metric(metric_map["engagementRate"], "engagementRate"),
    }

    top_pages = []
    for r in pages.rows[:CAPS["ga4_top_pages"]]:
        top_pages.append({
            "path": r.dimension_values[0].value,
            "title": r.dimension_values[1].value,
            "views": _parse_metric(r.metric_values[0].value, "topPages.views"),
            "activeUsers": _parse_metric(r.metric_values[1].value, "topPages.activeUsers"),
        })

    traffic_sources = []
    for r in sources.rows[:CAPS["ga4_traffic_sources"]]:
        traffic_sources.append({
            "sourceMedium": r.dimension_values[0].value,
            "sessions": _parse_metric(r.metric_values[0].value, "trafficSources.sessions"),
            "activeUsers": _parse_metric(r.metric_values[1].value, "trafficSources.activeUsers"),
        })

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "ga4",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
            "days": days,
        },
        "summary": summary,
        "topPages": top_pages,
        "trafficSources": traffic_sources,
    }
