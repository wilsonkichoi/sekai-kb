# ADR 013: Publish a generated agent-setup prompt

**Date:** 2026-08-18
**Status:** Accepted

## Context

An adopted instance already publishes two machine-readable ways to use its knowledge:

- the static `/llms.txt` and `/kb/` protocol, including `/kb/agent.md`; and
- an optional, read-only Streamable HTTP MCP endpoint with semantic search.

The `/ai` page explains both to a person. It does not give an AI client a complete,
client-aware setup procedure. Its MCP onboarding surface is one generic `mcpServers`
JSON block. That block is not portable: Codex CLI, Claude Code, Cursor, Gemini CLI,
GitHub Copilot, and hosted web chats use different commands, files, and approval models.

Instance #1 is the real requester. The intended use is broader than installing one
MCP server: a person should be able to give an AI one URL, have it learn how to answer
questions from this knowledge base, and have it identify the guarded contribution path
when the person asks to improve the corpus. This satisfies the `dev_docs/PRD.md`
framework-overreach gate. The justification is a current instance requirement, not a
hypothetical future adopter.

The two supplied `BECOME_*` bootloaders establish useful product intent. A boot document
can give a fresh session identity, operating rules, source-of-truth boundaries, and a
contribution workflow. They do not establish the right delivery shape for this feature.
They are long, repository-specific, and written for an agent already inside a checkout.
A public bootstrap must instead be a short dispatcher that points to the existing
machine protocol and performs only the setup supported by the current client.

Cloudflare provides direct prior art at
<https://developers.cloudflare.com/agent-setup/prompt.md>. As checked on 2026-08-18,
that fetched Markdown tells an agent to run client-specific commands that install skills
and MCP servers. It proves the interaction pattern is in production use. It is not a
standard, and its instruction to make configuration changes without asking the user is
not adopted here.

## Current client support

The classification asks one narrow question: can a stock client retrieve a supplied
setup URL and carry out a persistent remote-MCP registration, subject to its normal
approval controls? A client that can read the static protocol for one chat but cannot
persist the registration is classified by the persistent setup behavior.

| Client | Classification | Evidence and result |
|---|---|---|
| Claude Code | *acts on a fetched setup instruction* | As of 2026-08-18, Claude Code documents a built-in `WebFetch` tool and file-writing and shell tools, and documents `claude mcp add --transport http <name> <url>` for remote HTTP servers. Its MCP documentation also warns users to verify servers and identifies prompt injection from fetched external content. Sources: <https://code.claude.com/docs/en/tools-reference>, <https://code.claude.com/docs/en/mcp>. |
| Codex CLI | *acts on a fetched setup instruction* | As of 2026-08-18, official OpenAI documentation says local Codex chats have web search enabled by default, supports Streamable HTTP MCP servers, and stores user or trusted-project configuration in `config.toml`. A first-hand read-only check on 2026-08-18 ran `codex-cli 0.147.0` and `codex mcp add --help`; it reported `codex mcp add <name> --url <URL>` and described the URL as a Streamable HTTP server. No configuration was written. Sources: <https://developers.openai.com/codex/config-basic/>, <https://developers.openai.com/codex/mcp/>. |
| Cursor Agent | *acts on a fetched setup instruction* | As of 2026-08-18, Cursor documents automatic parsing of pasted public links into `@Link` context, Agent tools for web access, edits, and terminal commands, and remote MCP configuration in `.cursor/mcp.json` or `~/.cursor/mcp.json`. MCP tool use requires approval by default. Sources: <https://docs.cursor.com/context/%40-symbols/%40-link>, <https://docs.cursor.com/en/agent/tools>, <https://cursor.com/docs/mcp>. |
| GitHub Copilot Chat | *requires manual config* | As of 2026-08-18, GitHub's setup guide first requires the user to create `.vscode/mcp.json`, add the Fetch MCP server, save it, and start it before Copilot can fetch a web page. A URL-only bootstrap therefore has a dependency loop in a stock installation. The same guide documents manual remote-server configuration after that capability exists. Source: <https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp>. |
| ChatGPT web | *requires manual config* | As of 2026-08-18, ChatGPT web can use remote MCP-backed tools supplied by installed plugins, but official OpenAI documentation says it does not read local Codex configuration or expose the local command menu. The user manages tools through the Plugins UI. It can use the static protocol in a browsing chat, but it cannot perform the local persistent-registration flow. Source: <https://developers.openai.com/codex/mcp/>. |
| Gemini CLI | *acts on a fetched setup instruction* | As of 2026-08-18, Gemini CLI documents `web_fetch` for URLs in a prompt, with an explicit confirmation dialog, and `gemini mcp add --transport http <name> <url>` for Streamable HTTP servers. Sources: <https://geminicli.com/docs/tools/web-fetch/>, <https://geminicli.com/docs/tools/mcp-server/>. |

The matrix rules out a single universal install command. It does not rule out a single
universal prompt. The prompt can inspect capabilities and select one of three paths:

1. use `/kb/agent.md` in the current session when arbitrary URL fetch is available;
2. offer a client-specific remote-MCP registration when the client can persist one; or
3. print exact manual steps when the current host cannot fetch or cannot modify its own
   configuration.

Hosted web chats, terminal clients, and programmable agents therefore share a protocol,
not an identical installation mechanism. Agent hosts such as Hermes, pi, and LangChain
are supported at the contract boundary: any host with HTTP fetch can use the static
protocol, and any host with a Streamable HTTP MCP client can use the MCP endpoint. The
generated prompt must not claim zero-touch persistence for an agent host until that
host's current configuration path is verified and tested.

## Registry direction

The official MCP Registry is relevant but does not replace the artifact. As of
2026-08-18 it is still in preview. It standardizes public server metadata and supports
Streamable HTTP remote URLs through `server.json`; client marketplaces are expected to
consume that metadata. Sources:
<https://modelcontextprotocol.io/registry/about> and
<https://modelcontextprotocol.io/registry/remote-servers>.

An adopted instance has a distinct endpoint and identity. Registering every adopted
instance centrally would create per-instance publication and versioning work. More
importantly, a registry entry cannot express the static `/kb/` protocol, the current
session context, or the contribution workflow. Registry publication can be evaluated
later as an additional MCP discovery path. It is not a substitute for the generated,
instance-specific setup prompt.

## Security analysis

### Threat path

A fetched setup document that tells an agent to edit its own configuration is a prompt
injection sink. The user pastes a URL, the client fetches text controlled by that origin,
and the text asks the client to run commands or write a configuration file. A compromised
site build, domain, dependency, or maintainer account can turn a trusted setup URL into a
request to add a hostile server, overwrite instructions, expose environment variables,
or execute unrelated shell commands.

This risk is not theoretical protocol trivia. Claude Code warns that servers which fetch
external content can expose users to prompt injection. Codex documentation says cached
web search reduces exposure to arbitrary live content but still requires web results to
be treated as untrusted. The Cloudflare prior art demonstrates the exact config-write
path by instructing the receiving agent to run installation commands.

### What the MCP endpoint bounds

The instance MCP endpoint is read-only and rate-limited. It needs no credential from the
user and exposes only corpus retrieval and search. That bounds damage after a correct
registration: the server cannot edit the knowledge base or the user's machine, and rate
limits bound service abuse.

Those properties do not bound the installer prompt. The prompt runs before the endpoint
is trusted, and the receiving agent may have filesystem, shell, network, and repository
permissions that the MCP server does not have. A read-only destination does not make a
config-writing instruction read-only.

### Required mitigations

The recommendation remains to build, with all of these requirements in the follow-up
packet:

1. Generate the prompt from reviewed framework code plus `place.config.ts`. Do not
   interpolate article bodies, contribution text, or any other mutable knowledge content
   into executable instructions.
2. Limit generated network targets to the configured site origin and, when enabled, the
   existing `workers.mcp` endpoint. Both must be HTTPS. Do not request tokens, headers,
   OAuth grants, package installation, or unrelated servers.
3. Default to the static current-session path. MCP registration is an optional persistent
   enhancement for semantic search and clients that benefit from a remembered tool.
4. Before any command or config write, show the user the exact target file or command,
   the server name, and the endpoint. Require explicit approval. A fetched instruction
   never grants its own approval.
5. Make changes additive. Detect an existing entry, do not overwrite an entry with the
   same name but a different URL, and never remove or rewrite unrelated configuration.
6. After approval, verify with the client's read-only server-list command and one
   read-only corpus query. Report where the configuration was stored.
7. If the client cannot fetch, cannot persist configuration, or lacks approval, print the
   manual static and MCP steps and stop with a usable `/kb/agent.md` URL.
8. Treat contribution as a separate, user-requested workflow. The prompt may point to
   the repository and contribution instructions, but it must not modify content, create
   a commit, push a branch, or open a pull request merely because setup was requested.

## Options

| Option | Pros | Cons | Cost |
|---|---|---|---|
| Do not build | No new attack surface or maintenance; existing endpoints remain usable | Leaves the real onboarding request unresolved; every user must translate the `/ai` page into client-specific setup | none |
| Publish an instance-owned file under `public/` | Can be tailored immediately; no framework implementation | Duplicates protocol knowledge in every instance; client commands and security rules drift; the same requirement must be reimplemented per adopter | low once, recurring per instance |
| Publish a generated framework artifact (chosen) | One place-neutral implementation; identity and endpoint stay derived; every instance receives the same security and compatibility fixes; static-only instances still get a useful bootstrap | Adds a public prompt-injection surface; client command changes require maintenance | moderate |
| Rely on MCP registries and marketplaces | Uses an emerging discovery standard; can support one-click client flows | Registry is preview, covers MCP only, and creates per-instance publishing work; does not bootstrap static access or contribution context | moderate plus external operations |
| Merge setup into `/kb/agent.md` | One fewer file; existing link already discoverable | Mixes pre-trust config-writing instructions with post-access corpus instructions; forces every browsing question through installer content | low implementation, high conceptual coupling |

## Decision

Publish a framework-generated, fetchable setup prompt.

The five open questions are decided as follows.

1. **Client support:** one URL is viable as a capability-driven dispatcher, not as a
   universal command. Claude Code, Codex CLI, Cursor Agent, and Gemini CLI can act on the
   fetched instructions with their approval controls. GitHub Copilot needs manual fetch
   setup first. Hosted web chat uses the static current-session branch and requires its
   own UI for persistent plugins or connectors.
2. **Framework or instance:** this is a framework artifact. Instance #1 supplies the
   real-adopter justification, while the behavior is generic across adopted instances.
   The output is generated from existing configuration rather than hand-authored in an
   instance's `public/` tree.
3. **Security model:** build only with the mitigation set above. The read-only,
   rate-limited MCP endpoint reduces post-registration impact but does not reduce the
   fetched-text config-write risk. Explicit approval and additive, target-constrained
   writes are mandatory.
4. **Path and discovery:** use `/agent-setup/prompt.md`. `/setup.md` is too broad and can
   be confused with site deployment. A `BECOME_<PLACE>.md` path leaks instance identity
   into a framework contract and is ruled out. No client currently auto-discovers this
   path, so discoverability comes from explicit links on `/ai` and in `llms.txt`.
5. **Relationship to `/kb/agent.md`:** keep it separate. The setup prompt is the
   pre-access dispatcher and optional installer. `/kb/agent.md` remains the stable,
   vendor-neutral operational protocol for an agent that already has HTTP access. The
   setup prompt fetches or points to `/kb/agent.md`; it does not duplicate its topic
   index or article-reading instructions.

## Delivery shape for the follow-up packet

The implementation packet is a framework task with this shape:

- `src/lib/agent-boot.ts` adds `KB_PATHS.agentSetup` and a pure renderer for the setup
  prompt. Identity strings come from `place.config.ts`; the MCP block uses the existing
  absent-safe `resolveMcp` result.
- `scripts/core/build-kb-index.mjs`, the producer for `/llms.txt` and `/kb/agent.md`,
  emits `public/agent-setup/prompt.md` in the same scan. The generated `public/llms.txt`
  links the setup prompt under Machine endpoints. Generated outputs remain derived and
  are never edited directly.
- `/ai` remains the human overview and links `/agent-setup/prompt.md`. Its current
  generic `mcpServers` JSON is superseded by the client-aware setup link or explicitly
  labeled as a limited generic example. The endpoint and tool description remain.
- `src/lib/ai-paths.ts` does not gain a fifth path ID. The setup prompt selects among
  existing consumption paths; it is not a new corpus transport. Its URL is documented
  inside the existing static section, using `KB_PATHS.agentSetup`.
- `/kb/agent.md` keeps its current job and content boundary. It may name the setup URL
  only if a post-access reader needs to configure persistence; the setup artifact must
  not be merged into it.
- `dev_docs/SPEC.md` section Pages adds the non-route output and its discovery links.
  Section MCP delivery records the approved onboarding role without changing D4.
  `scripts/ci/check-framework-docs.mjs` is amended so the code-derived non-route output
  list cannot drift from the specification.
- `tests/agent-boot.test.mjs`, `tests/ai-page.test.mjs`, and the post-build link checks
  cover generation, identity derivation, MCP-on and MCP-off output, discovery links,
  client branches, approval language, and the absence of credentials or unrelated
  commands.
- No new `place.config.ts` key is required. The static protocol always exists, so the
  setup artifact is always useful. A missing `features.mcp` or worker endpoint omits the
  MCP registration branch under the existing absent-safe rule.

The follow-up Objective is:

> Generate `/agent-setup/prompt.md` for every adopted instance so a person can give one
> URL to a web chat, coding client, or programmable agent and receive a capability-
> appropriate static or MCP setup path, with explicit approval before configuration
> writes and a separate pointer to the contribution workflow.

The SPEC delta is limited to `dev_docs/SPEC.md` sections Pages and MCP delivery. It adds
the non-route output, discovery links, the setup-versus-operational boundary, and the
security requirements above. It does not change the product goal, MCP tool contract, or
static-first order.

## D4 application

The 2026-08-12 ROADMAP amendment D4 remains binding: the static protocol is first and
MCP is second. The setup prompt begins with `/kb/agent.md` for any client that can fetch
arbitrary URLs. It offers MCP afterward for persistent registration, clients whose host
benefits from a registered tool, and `semantic_search`. It does not describe MCP as the
primary way to browse the corpus and does not re-open the recorded ordering.

## Existing-surface ownership

| Surface | Decision |
|---|---|
| `/ai` | Keeps the human-facing inventory of every available AI path. Links the setup prompt and stops presenting one generic JSON shape as sufficient for every client. |
| `/agent-setup/prompt.md` | New pre-access, capability-driven dispatcher. May propose an approved config change and points to the static boot and contribution surfaces. |
| `/kb/agent.md` | Keeps the post-access operational protocol, identity, topic index, fetch order, and MCP endpoint description. It is not an installer. |
| `/llms.txt` | Keeps the corpus catalog role and adds a discovery link to the setup prompt beside the existing machine endpoints. |
| MCP registries | Optional future discovery for the remote endpoint. They do not own static access, session context, or contribution setup. |

## Genericity

The path is fixed and place-neutral. Every identity string, site URL, repository URL,
server display name, and optional MCP endpoint is derived from `place.config.ts`. The
renderer contains zero place strings and no `BECOME_<PLACE>.md` variant. Template-mode
`npm run genericity` scans this ADR and the eventual implementation over the whole
repository.

## Consequences

- The framework gains one public Markdown instruction surface. Security review applies
  to its rendered commands and prose, not only to the MCP worker.
- A user can bootstrap a browsing chat without changing configuration. Persistent MCP
  setup remains optional and approval-gated.
- Client-specific commands can drift as vendors change their configuration formats.
  The implementation tests the shapes the framework emits, and future updates must
  re-check the official client documentation. No local CI test can prove an external
  vendor still accepts a command.
- The setup artifact stays small. It links the operational boot file and contribution
  instructions instead of copying the supplied repository bootloaders.
- The artifact adds no schema migration and is safe for existing instances on upgrade.
- This decision does not authorize the spike PR to ship the output. The spike PR remains
  artifact-only; implementation returns through a new backlog packet and the normal
  review, CI, and verification lifecycle.
