# US-010 Init payload and registration

## Status

planned

## Lane

normal

## Product Contract

`harness init` prepares a target project for markdown SoT and registers it in
the global registry. It does **not** treat project SQLite as the long-term
durable SoT.

## Relevant Product Docs

- `docs/product/init-payload.md`
- `docs/product/global-registry.md`
- `docs/product/distribution.md`

## Acceptance Criteria

- Init creates durable dirs: stories, decisions, intakes, backlog (+ READMEs).
- Init merges `.gitignore` for `.harness/index/`, `.harness/local/`, and legacy
  `harness.db*` (if still created during transition, keep ignored).
- Init **registers** the project (same registry as US-006).
- Init no longer *requires* a working project SQLite SoT for success once
  US-007/008 land (transition: may still create empty DB until US-013).
- `--dry-run` shows planned registry + file actions without writing.
- `harness link` on an already-scaffolded clone registers + reindexes without
  overwriting policy files.
- Tests update init assertions (manifest + registry).
- docs: init-payload, overview, README install story.

## Design Notes

- Depends on: US-006 (registry), US-007 (entity dirs meaningful)
- Manifest-driven file list remains the source for template copies
- Protected path conflict policy unchanged unless extended

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | gitignore merge rules |
| Integration | init temp dir structure |
| E2E | init → registered in HARNESS_HOME |
| Platform | Windows |
| Release | pack includes updated templates |

## Harness Delta

- templates/manifest.json expansion
- scaffold module + registry hook

## Evidence

_(fill when implemented)_
