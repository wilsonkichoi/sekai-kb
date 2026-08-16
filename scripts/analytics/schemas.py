"""Normalized analytics schema constants."""

from pathlib import Path

SCHEMA_VERSION = 1

OUTPUT_DIR = Path("src/data/analytics")

OUTPUT_FILES = {
    "ga4": OUTPUT_DIR / "ga4.json",
    "search-console": OUTPUT_DIR / "search-console.json",
    "cloudflare": OUTPUT_DIR / "cloudflare.json",
}

CAPS = {
    "ga4_top_pages": 50,
    "ga4_traffic_sources": 25,
    "sc_top_queries": 100,
    "sc_top_pages": 100,
    "cf_top_countries": 30,
    "cf_status_codes": 20,
}
