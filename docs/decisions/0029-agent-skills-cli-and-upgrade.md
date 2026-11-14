---
created_at: "2026-11-14T08:55:17.307271+00:00"
doc: docs/decisions/0029-agent-skills-cli-and-upgrade.md
id: 0029-agent-skills-cli-and-upgrade
links:
  - IN-041
notes: "Upgrade AGENTS.md managed HARNESS block and SKILL.md together via harness upgrade; embed fallback templates in binary so upgrade and skill install work without adjacent npm package root. Provide harness skill (alias skills) subcommands add/install, list, remove/rm, agents, and show following the Agent Skills SKILL.md standard and npx skills flags (-g/--global, -a/--agent, --skill, -y/--yes, --all, --dry-run, --json) with symlink/traversal safety, offline bundled harness skill, local folder install, and shallow git repo install."
status: accepted
title: Agent skills installer CLI and real template/skill upgrade
type: decision
updated_at: "2026-11-14T08:55:17.307273700+00:00"
verify: null
---

# Agent skills installer CLI and real template/skill upgrade
