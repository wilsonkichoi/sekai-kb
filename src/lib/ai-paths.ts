/**
 * ai-paths.ts — which AI consumption paths this instance actually serves.
 *
 * Four paths exist in the framework: the `llms.txt` boot files, the `/kb/` fetch
 * protocol, the remote MCP endpoint, and the `/chat` page. Two of them are always
 * published because they are static files the build emits; two are feature-gated on a
 * deployed Worker. The `/ai` page renders one section per entry returned here, so a
 * capability this instance does not run produces no section rather than a section
 * explaining its own absence -- the same rule the Header and Footer already apply to
 * `/chat`, for the same reason: a documented path that answers nothing costs a reader
 * (and an agent) a request and a failure.
 *
 * ORDER IS THE DECISION, not a layout preference. ADR/ROADMAP amendment D4 settles the
 * overlap between the static protocol and MCP: `/llms.txt` + `/kb/` lead because they
 * serve any consumer able to fetch a URL at zero infrastructure cost, and MCP follows
 * because what it adds is the clients that cannot fetch arbitrary URLs and semantic
 * retrieval. Reordering this array reverses a recorded decision.
 *
 * This file lives under src/, which both machine gates scan: its source is pure ASCII
 * and carries no place-specific string.
 */
import type { PlaceConfig } from '../../place.config';
// Explicit `.ts`: scripts/core/post-build-check.mjs imports this module under plain
// Node, whose resolver requires the extension (see src/lib/agent-boot.ts).
import { KB_PATHS } from './agent-boot.ts';
import { resolveChat } from './chat.ts';
import { resolveMcp } from './mcp.ts';

/** The AI consumption paths, in the order the `/ai` page presents them (D4). */
export type AiPathId = 'llms' | 'kb' | 'mcp' | 'chat';

export interface AiPath {
  id: AiPathId;
  /** Where the path is reached: site-root-absolute for llms/kb/chat, absolute for mcp. */
  href: string;
  /** True only for `mcp`, whose href is an off-origin Worker endpoint. */
  external: boolean;
}

/**
 * Every AI consumption path this instance serves, in D4 order. Absent-safe over a
 * config predating `features.mcp` or `features.chat`: both gates are the shared
 * both-halves predicates, so a missing key reads as off rather than throwing.
 */
export function aiPaths(config: PlaceConfig): AiPath[] {
  const paths: AiPath[] = [
    { id: 'llms', href: KB_PATHS.llmsTxt, external: false },
    { id: 'kb', href: KB_PATHS.topics, external: false },
  ];

  const mcp = resolveMcp(config);
  if (mcp.enabled) paths.push({ id: 'mcp', href: mcp.endpoint, external: true });

  if (resolveChat(config).enabled) paths.push({ id: 'chat', href: '/chat', external: false });

  return paths;
}
