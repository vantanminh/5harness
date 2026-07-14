# Examples: Adding Harness to an Existing Project

> A step-by-step walkthrough of adding 5harness to a project that already has
> code, git history, and an established codebase — without disrupting existing
> work.

---

## Scenario

You have an existing **Express blog API** that's been in development for a few
months. It has:
- `src/` with routes, middleware, and models
- `package.json` with dependencies
- `tests/` with a basic test suite
- Git history with dozens of commits

You want to add 5harness to bring structure, track decisions, and make the
project agent-friendly — without rewriting anything.

---

## Step 1: Install 5harness

```bash
npm i -g 5harness
harness --version
```

---

## Step 2: Init Harness Into the Existing Project

Navigate to the project root and run init:

```bash
cd ~/projects/blog-api
harness init
```

> **What happens?** `harness init` detects the existing project and scaffolds
> harness operating files **alongside** your code. It does NOT delete or
> overwrite any existing files. It adds:
> - `AGENTS.md` (agent entrypoint)
> - `docs/` with harness documentation and entity directories
> - `.5harness/` for the derived index
> - `.gitignore` entries (appended if `.gitignore` already exists)

After init, your project looks like:

```
blog-api/
├── src/                    # ← your existing code (untouched)
│   ├── routes/
│   ├── middleware/
│   └── models/
├── tests/                  # ← your existing tests (untouched)
├── package.json            # ← your existing config (untouched)
├── AGENTS.md               # ← NEW: harness entrypoint
├── docs/                   # ← NEW: harness operating docs
│   ├── HARNESS.md
│   ├── FEATURE_INTAKE.md
│   ├── ARCHITECTURE.md
│   ├── CONTEXT_RULES.md
│   ├── stories/
│   ├── decisions/
│   ├── intakes/
│   ├── backlog/
│   └── product/
├── .5harness/              # ← NEW: derived index
└── .gitignore              # ← UPDATED: harness entries appended
```

Check that everything is healthy:

```bash
harness doctor
```

---

## Step 3: Document the Architecture

Fill in `docs/ARCHITECTURE.md` with your existing stack and decisions:

```markdown
# Architecture

## Stack
- **Runtime:** Node.js 22
- **Framework:** Express 5
- **Database:** PostgreSQL via `pg`
- **Auth:** JWT with refresh tokens
- **Testing:** Vitest

## Layering
- `src/routes/` — HTTP handlers
- `src/middleware/` — auth, validation, error handling
- `src/models/` — database queries and business logic
```

---

## Step 4: Classify Existing Work — Backfill Intakes

Create intakes for features already built, to establish a durable history:

```bash
# Existing feature: user authentication
harness intake \
  --type spec_slice \
  --summary "User authentication with JWT login/register/refresh" \
  --lane normal \
  --notes "Already implemented. Backfilling for history."

# Existing feature: blog CRUD


---

## Step 8: Implement a Feature — Full Workflow

Now use the harness workflow for new work. Here's implementing the comment system:

```bash
# 1. Intake (classify new work)
harness intake \
  --type spec_slice \
  --summary "Nested comment system: CRUD comments on posts, replies to comments" \
  --lane normal \
  --docs "docs/product/blog-api-spec.md"

# 2. Implementation (agent or developer writes code)
# ... write src/routes/comments.ts, src/models/comments.ts ...
# ... write tests/comments.test.ts ...

# 3. Verify
harness story update \
  --id US-001 \
  --status implemented \
  --unit 1 \
  --integration 1 \
  --e2e 0 \
  --platform 0 \
  --evidence "Unit: 12/12 pass. Integration: 5/5 pass. Manual curl tested nested replies."

# 4. Trace
harness trace \
  --story US-001 \
  --summary "Implemented nested comment system with replies" \
  --outcome completed \
  --actions "created comments routes+model, added unit+integration tests, tested nested replies" \
  --read "docs/product/blog-api-spec.md,docs/ARCHITECTURE.md" \
  --changed "src/routes/comments.ts,src/models/comments.ts,tests/comments.test.ts" \
  --friction "none"
```

---

## Step 9: Collaborate — Clone on Another Machine

Another developer clones the repo. They don't need `harness init` — just `link`:

```bash
git clone git@github.com:team/blog-api.git
cd blog-api
npm i -g 5harness
harness link              # registers clone + reindexes committed history
harness query matrix      # sees all stories immediately
harness next              # knows what to work on
```

`harness link` discovers the existing harness markdown in the repo, registers
the clone path, and rebuilds the index from committed entities.

---

## Step 10: Periodic Health Checks

```bash
harness audit
harness query stats
harness doctor
```

---

## Full Command Timeline (Existing Project)

```
harness init              # scaffold harness into existing project
harness doctor            # verify health
# ... document architecture in docs/ARCHITECTURE.md ...
harness intake            → IN-001, IN-002 (backfill history)
harness decision add      → 0001, 0002 (record decisions)
harness backlog add       → BL-001, BL-002 (known issues)
harness story add         → US-001, US-002 (plan new work)
# ... implement ...
harness story update      → US-001 implemented (verify)
harness trace             → trace #1 (record)
harness next              → US-002 (next story)
```

---

## Key Differences: Init vs Link

| Situation | Command | What it does |
|---|---|---|
| First time adding harness to any project | `harness init` | Scaffolds `AGENTS.md`, `docs/`, `.5harness/`; registers in `~/.5harness` |
| Cloning a repo that already has harness | `harness link` | Registers the clone path in `~/.5harness`; reindexes from committed markdown |
| Re-registering a moved project | `harness link` | Updates the registry pointer without re-scaffolding |

---

## Key Takeaways

1. **`harness init` is non-destructive** — it scaffolds alongside your code, never overwrites
2. **Backfill history** — create intakes and decisions for existing work to build durable context
3. **Backlog existing pain** — known issues become trackable backlog items
4. **`harness link` for clones** — teammates don't re-init, they link
5. **Gradual adoption** — you don't need to classify everything at once; add harness as you go
6. **Same workflow for new work** — once harness is in place, new features follow intake → story → implement → verify → trace

> **Reference:** `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`,
> `docs/WORKFLOW_VI.md`, `docs/GLOSSARY.md`

harness intake \
  --type spec_slice \
  --summary "Blog post CRUD with draft/published states" \
  --lane normal \
  --notes "Already implemented. Backfilling for history."
```

---

## Step 5: Record Durable Decisions

Existing architecture choices deserve durable decision records:

```bash
harness decision add \
  --id 0001 \
  --title "PostgreSQL over SQLite" \
  --doc docs/decisions/0001-postgres-choice.md \
  --notes "Chose PostgreSQL for JSONB support and production readiness. Using pg driver directly, no ORM."

harness decision add \
  --id 0002 \
  --title "JWT auth with refresh token rotation" \
  --doc docs/decisions/0002-jwt-auth.md \
  --notes "Short-lived access tokens (15min) + refresh tokens with rotation. Stored in httpOnly cookies."
```

---

## Step 6: Create Stories for Planned Work

Now that harness is in place, use stories for upcoming features:

```bash
harness story add \
  --id US-001 \
  --title "Add comment system to blog posts" \
  --lane normal

harness story add \
  --id US-002 \
  --title "Add tag/category filtering for posts" \
  --lane normal
```

Check the matrix:

```bash
harness query matrix
```

---

## Step 7: Add Known Issues to Backlog

Existing pain points go into the backlog:

```bash
harness backlog add \
  --title "No request rate limiting" \
  --while "monitoring production traffic" \
  --pain "No protection against brute-force or abuse on auth endpoints"

harness backlog add \
  --title "Test coverage below 40%" \
  --while "refactoring route handlers" \
  --pain "Can't confidently refactor without risking regressions"
```
