# Examples: New Project From Scratch

> A step-by-step walkthrough of using 5harness to build a project from an
> empty folder — from idea to completed work, following the standard harness
> workflow.

---

## Scenario

You want to build a simple **TODO API** with Node.js and Express. The folder is
empty. You'll use 5harness to structure the work, track decisions, and record
proof of completion.

---

## Step 1: Install 5harness

```bash
npm i -g 5harness
harness --version   # confirm it works
```

---

## Step 2: Init the Project

```bash
mkdir todo-api && cd todo-api
git init
harness init
```

What `harness init` does:
- Scaffolds `AGENTS.md` (agent entrypoint with harness block)
- Creates `docs/` with `HARNESS.md`, `FEATURE_INTAKE.md`, `ARCHITECTURE.md`,
  `CONTEXT_RULES.md`, and folder structure for stories, decisions, intakes,
  backlog
- Registers the project in `~/.5harness` (machine-local registry)
- Auto-reindexes: the derived index is ready immediately

```
todo-api/
├── AGENTS.md
├── docs/
│   ├── HARNESS.md
│   ├── FEATURE_INTAKE.md
│   ├── ARCHITECTURE.md
│   ├── CONTEXT_RULES.md
│   ├── README.md
│   ├── TEST_MATRIX.md
│   ├── stories/
│   ├── decisions/
│   ├── intakes/
│   ├── backlog/
│   └── product/
├── .5harness/
│   └── index/
└── .gitignore
```

---

## Step 3: Classify the Idea — Feature Intake

Before writing a single line of code, classify the work through intake:

```bash
harness intake \
  --type new_spec \
  --summary "Build a TODO REST API with CRUD endpoints for tasks" \
  --lane normal \
  --docs "docs/product/overview.md,docs/product/todo-api-spec.md"
```

Console output:
```
Intake IN-001 recorded.
```

> **Why intake first?** The harness classifies risk before implementation.
> For a CRUD API, the lane is `normal` — story-sized, bounded blast radius.
> The intake record is durable Git-backed markdown under `docs/intakes/IN-001.md`.

---

## Step 4: Create Product Docs & Stories

Write a short product spec and create a story for the first slice:

```bash
# Create product overview (hand-written or agent-generated)
# docs/product/overview.md describes the API contract

# Create the story
harness story add \
  --id US-001 \
  --title "TODO CRUD endpoints" \
  --lane normal
```

Now you have a story in the matrix. Check with:

```bash
harness query matrix
harness get US-001
```

---

## Step 5: Implement — Agent Work Loop

Now the agent (or you) implements the code. This is the product delta:

```bash
mkdir src
# write src/index.ts, package.json, tsconfig.json...
npm init -y
npm install express
npm install -D typescript @types/express @types/node
```

After implementation:

```bash
npm test   # run your test suite
```

---

## Step 6: Record Validation Proof

Update the story with verification status:

```bash
harness story update \
  --id US-001 \
  --status implemented \
  --unit 1 \
  --integration 1 \
  --e2e 0 \
  --platform 0 \
  --evidence "Unit: 8/8 pass. Integration: 3/3 pass. Manual curl tested all CRUD endpoints."
```

---

## Step 7: Trace the Work

Record a trace for this task — durable proof of what happened:

```bash
harness trace \
  --story US-001 \
  --summary "Implemented TODO CRUD API endpoints" \
  --outcome completed \
  --actions "scaffolded Express app, implemented GET/POST/PUT/DELETE /tasks, added unit+integration tests" \
  --read "docs/product/overview.md,docs/intakes/IN-001.md" \
  --changed "src/index.ts,package.json,tsconfig.json" \
  --friction "none"
```

Console output:
```
Trace #1 recorded.
  Tier achieved: minimal
  Missing:
    - standard: agent
```

---

## Step 8: Record Decisions (if needed)

If you made architecture choices worth remembering, record them:

```bash
harness decision add \
  --id 0001 \
  --title "In-memory storage for MVP" \
  --doc docs/decisions/0001-in-memory-storage.md \
  --notes "Chose in-memory Map over SQLite to keep MVP simple. Will migrate when persistence is needed."
```

---

## Step 9: Discover Friction → Backlog

If you found something missing in the harness or project setup, record it:

```bash
harness backlog add \
  --title "Add CI test workflow" \
  --while "verifying tests manually" \
  --pain "No automated CI to catch regressions on push"
```

---

## Step 10: Audit & Propose

Periodically check project health:

```bash
harness audit
harness propose
harness query stats
```

```
=== Harness Stats ===
intakes  stories  decisions  backlog_items  traces
-------  -------  ---------  -------------  ------
1        1        1          1              1
```

---

## Step 11: Continue the Loop

The next intent feeds back into intake:

```bash
harness intake \
  --type spec_slice \
  --summary "Add task priority field and filtering" \
  --lane normal

harness story add \
  --id US-002 \
  --title "Task priority and filtering" \
  --lane normal

# ... implement, verify, trace ... repeat
```

---

## Full Command Timeline

```
harness init
harness intake          → IN-001 (classify)
harness story add       → US-001 (plan)
# ... code ...
harness story update    → US-001 implemented (verify)
harness trace           → trace #1 (record)
harness decision add    → 0001 (decide)
harness backlog add     → BL-001 (improve)
harness audit           → health check
harness next            → what's next?
```

---

## Key Takeaways

1. **Intake before code** — classify risk and lane first
2. **Story before implementation** — one story = one unit of work
3. **Trace after completion** — durable record of what happened
4. **Decisions for architecture** — don't lose important trade-offs
5. **Backlog for friction** — improve the harness as you go
6. **Everything is Git-backed markdown** — portable, reviewable, durable

> **Reference:** `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`,
> `docs/WORKFLOW_VI.md`, `docs/GLOSSARY.md`
