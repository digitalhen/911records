# CLAUDE.md — 911records.nyc (this repo)

Plan of record: `docs/PLAN.md`. Ops: `docs/RUNBOOK.md`. Rules for web agents: `docs/briefs/COMMON-web.md`.
Pushing to `main` deploys to production on both Dokploy hosts.

## Release rule (Henry, 2026-09-14) — maintain with every release
- `web/lib/releases.ts` holds `APP_VERSION` and `RELEASES`. **Every merge to `main` that changes
  anything a visitor can see or do** bumps the version (patch for fixes, minor for features, major
  for a redesign) and prepends a `RELEASES` entry dated that day.
- Release notes describe **user-facing features and changes only**, in plain language a family
  member or lawyer would understand: what they can now do, what looks or behaves differently, what
  was fixed as they would have noticed it. Never internal work (refactors, pipeline stages,
  infrastructure, dependencies, agent names, ticket numbers).
- The footer shows the version linking to `/releases`; `/api/health` reports it. A merge without
  a user-visible change does not bump the version.
- Agents propose the note text in their report; the coordinator writes it at merge.
