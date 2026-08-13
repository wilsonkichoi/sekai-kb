/**
 * mcp.ts — the one place that decides whether this instance has a remote MCP endpoint.
 *
 * The MCP worker is registered by AI clients, not visited by readers, so what the site
 * owes it is discoverability: `llms.txt` lists the endpoint when it exists, and nothing
 * at all when it does not. A published endpoint that answers nothing is worse than no
 * endpoint, so the predicate lives here rather than being spelled out per surface.
 *
 * The gate is BOTH halves, matching `chat.ts` and `FeedbackWidget.astro`: a
 * `features.mcp` flag turned on before the worker exists would advertise a URL that
 * refuses every connection, and an endpoint configured while the flag is off is a
 * deliberate "not yet".
 *
 * ABSENT-SAFE, which is a SPEC invariant and not a courtesy: `features` may predate
 * `mcp`, and `workers` and every key inside it are optional, so a config written before
 * either key existed reads as off rather than throwing. That is what lets an instance
 * merge a framework release without editing its config first.
 *
 * This file lives under src/, which both machine gates scan: its source is pure ASCII
 * and carries no place-specific string.
 */
import type { PlaceConfig } from '../../place.config';

export interface McpSurface {
  /** True only when the feature flag is on AND a non-empty endpoint is configured. */
  enabled: boolean;
  /** The trimmed worker endpoint, or `''` when none is configured. */
  endpoint: string;
}

/**
 * Resolves the MCP surface from a place config. Total over the four flag/endpoint
 * combinations: only flag-on plus non-empty-endpoint enables anything.
 */
export function resolveMcp(config: PlaceConfig): McpSurface {
  const endpoint = (config.workers?.mcp ?? '').trim();
  return {
    enabled: config.features?.mcp === true && endpoint !== '',
    endpoint,
  };
}
