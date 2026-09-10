<!-- @cf:root-agents -->
```toml
cf-studio-path = ".cf-studio"
```

ALWAYS resolve and enforce prerequisites of skills/workflows/commands BEFORE applying user intent.
<!-- /@cf:root-agents -->

AI tooling and FrontX development guidelines are provided by the Constructor Studio kit under `.cf-studio/`.

Treat `architecture/` as the authority on what the system is and why: PRD for intent, DESIGN for structure, ADRs for decisions, and each FEATURE for the behaviour its numbered instructions specify. Ecosystem code carries `@cpt-` markers back to those instructions; `cfs validate` checks that the chain holds. Template territory — any top-level directory carrying a `frontx-template.json` manifest (how `scripts/template-discovery.mjs` finds templates) — sits outside this chain: markers found there are non-authoritative residue being retired as files change (`cpt-frontx-adr-template-territory-traceability`).

Commit requirements — DCO sign-off (`git commit -s`), branch targets, PR flow — live in `CONTRIBUTING.md`; read it before your first commit, including how it's enforced.

ALL user requests MUST be handled by the Orchestrator agent.
