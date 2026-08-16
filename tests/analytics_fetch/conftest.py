"""Shared fixtures for analytics fetch tests."""

import os
import pytest
from pathlib import Path


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    """Ensure no real credentials leak and OUTPUT_DIR points to tmp."""
    for var in (
        "GA4_PROPERTY_ID",
        "SC_SITE_URL",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "CF_API_TOKEN",
        "CF_ZONE_ID",
    ):
        monkeypatch.delenv(var, raising=False)

    import scripts.analytics.schemas as schemas
    monkeypatch.setattr(schemas, "OUTPUT_DIR", tmp_path / "analytics")


@pytest.fixture
def output_dir(tmp_path):
    return tmp_path / "analytics"
