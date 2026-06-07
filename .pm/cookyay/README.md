# Cookyay — free, self-hosted cookie consent — Project workspace

This folder holds the project's PRD, research, and tasks. Managed by the `pm` plugin.

## Layout
- `prd.md` — canonical product vision. Mutable via `/pm:amend`.
- `v1/`, `v2/`, ... — versioned milestones. Each contains:
  - `goals.md` — what this version delivers
  - `research/` — per-persona research reports written by `/pm:research`
  - `tasks/` — one task file per unit of work, written by `/pm:plan`
  - `RELEASE.md` — written by `/pm:release` when the version ships (frozen)

## Workflow
1. `/pm:prd <idea>` (done — that's how this folder exists)
2. `/pm:research <slug>` — multi-persona research
3. `/pm:plan <slug>` — generate ordered tasks
4. `/pm:execute <slug>` — execute next ready task
5. `/pm:verify <slug>` — verify completion
6. `/pm:release <slug>` — close out the version
7. `/pm:version <slug> v2` — start the next milestone
