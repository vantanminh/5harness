# Global Registry and Link Model

> **Locked by** [decision 0011](../decisions/0011-global-tool-markdown-durable-index.md).

## Why

The CLI is installed **once on the machine** (`npm i -g`). Many projects may be
harnessed. A future **browser dashboard** needs a way to discover which local
paths are harness projects.

The registry stores **pointers only**. Full history lives in each project’s
git-tracked markdown.

## Layout (illustrative)

```text
~/.5harness/
  registry.json          # list of linked projects
  cache/                 # optional dashboard/query cache
  projects/<id>/         # optional per-project machine-local data (traces…)
```

Registry entry fields (minimum):

| Field | Purpose |
| --- | --- |
| `id` | Stable local id |
| `path` | Absolute path to project root |
| `name` | Display name (folder or package name) |
| `linked_at` | When registered |
| `remote` | Optional git remote URL if detectable |
| `last_reindex_at` | Optional |

## Commands (direction)

| Command | Behavior |
| --- | --- |
| `harness init` | Scaffold project + **register** path |
| `harness link [path]` | Register existing harness project (clone workflow); reindex |
| `harness unlink [path]` | Remove registry entry (does not delete project files) |
| `harness projects` | List linked projects (for humans / dashboard prep) |

## Clone workflow (product requirement)

```bash
# Machine A
cd my-app
harness init
# … agents/humans create stories via CLI …
git add docs/ AGENTS.md && git commit && git push

# Machine B (another person)
git clone <repo>
npm i -g 5harness
cd my-app
harness link
# dashboard / query now see committed history at this path
```

No shared global cloud state is required for this workflow.

## Stale paths

If a project is moved or deleted, registry entries may break. CLI should:

- Detect missing path on `projects` / dashboard load.
- Support `unlink` and re-`link` at the new path.

## Non-goals

- Syncing registry across machines.
- Storing full story/decision bodies in `~/.5harness`.
- Replacing Git as the collaboration channel.
