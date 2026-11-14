use std::env;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};

pub const BUNDLED_AGENTS_MD: &str = include_str!("../../templates/AGENTS.md");
pub const BUNDLED_HARNESS_SKILL_MD: &str =
    include_str!("../../templates/.agents/skills/harness/SKILL.md");
pub const BUNDLED_SKILL_NAME: &str = "harness";
pub const SKILLS_LOCK_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug)]
pub struct AgentSpec {
    pub id: &'static str,
    pub aliases: &'static [&'static str],
    pub display_name: &'static str,
    pub project_skills_dir: &'static str,
    pub global_skills_dir: &'static str,
    pub global_detect_markers: &'static [&'static str],
    pub project_detect_markers: &'static [&'static str],
}

pub const SUPPORTED_AGENTS: &[AgentSpec] = &[
    AgentSpec {
        id: "universal",
        aliases: &["agents"],
        display_name: "Universal (.agents)",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".agents/skills",
        global_detect_markers: &[".agents"],
        project_detect_markers: &[".agents"],
    },
    AgentSpec {
        id: "antigravity",
        aliases: &["antigravity-cli", "agy"],
        display_name: "Antigravity",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".gemini/config/skills",
        global_detect_markers: &[".gemini/config", ".gemini/antigravity"],
        project_detect_markers: &[".agents"],
    },
    AgentSpec {
        id: "claude-code",
        aliases: &["claude"],
        display_name: "Claude Code",
        project_skills_dir: ".claude/skills",
        global_skills_dir: ".claude/skills",
        global_detect_markers: &[".claude"],
        project_detect_markers: &[".claude"],
    },
    AgentSpec {
        id: "cursor",
        aliases: &[],
        display_name: "Cursor",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".cursor/skills",
        global_detect_markers: &[".cursor"],
        project_detect_markers: &[".cursor"],
    },
    AgentSpec {
        id: "codex",
        aliases: &[],
        display_name: "OpenAI Codex",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".agents/skills",
        global_detect_markers: &[".codex"],
        project_detect_markers: &[".codex"],
    },
    AgentSpec {
        id: "gemini-cli",
        aliases: &["gemini"],
        display_name: "Gemini CLI",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".gemini/skills",
        global_detect_markers: &[
            ".gemini/skills",
            ".gemini/settings.json",
            ".gemini/GEMINI.md",
        ],
        project_detect_markers: &[".gemini"],
    },
    AgentSpec {
        id: "github-copilot",
        aliases: &["copilot"],
        display_name: "GitHub Copilot",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".copilot/skills",
        global_detect_markers: &[".copilot"],
        project_detect_markers: &[".github/copilot-instructions.md"],
    },
    AgentSpec {
        id: "cline",
        aliases: &[],
        display_name: "Cline",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".agents/skills",
        global_detect_markers: &[".cline"],
        project_detect_markers: &[".clinerules"],
    },
    AgentSpec {
        id: "windsurf",
        aliases: &[],
        display_name: "Windsurf",
        project_skills_dir: ".windsurf/skills",
        global_skills_dir: ".codeium/windsurf/skills",
        global_detect_markers: &[".codeium/windsurf"],
        project_detect_markers: &[".windsurf"],
    },
    AgentSpec {
        id: "opencode",
        aliases: &[],
        display_name: "OpenCode",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".config/opencode/skills",
        global_detect_markers: &[".config/opencode"],
        project_detect_markers: &[".opencode"],
    },
    AgentSpec {
        id: "continue",
        aliases: &[],
        display_name: "Continue",
        project_skills_dir: ".continue/skills",
        global_skills_dir: ".continue/skills",
        global_detect_markers: &[".continue"],
        project_detect_markers: &[".continue"],
    },
    AgentSpec {
        id: "goose",
        aliases: &[],
        display_name: "Goose",
        project_skills_dir: ".goose/skills",
        global_skills_dir: ".goose/skills",
        global_detect_markers: &[".goose"],
        project_detect_markers: &[".goose"],
    },
    AgentSpec {
        id: "amp",
        aliases: &[],
        display_name: "Amp",
        project_skills_dir: ".agents/skills",
        global_skills_dir: ".config/agents/skills",
        global_detect_markers: &[".config/agents"],
        project_detect_markers: &[],
    },
    AgentSpec {
        id: "augment",
        aliases: &[],
        display_name: "Augment",
        project_skills_dir: ".augment/skills",
        global_skills_dir: ".augment/skills",
        global_detect_markers: &[".augment"],
        project_detect_markers: &[".augment"],
    },
    AgentSpec {
        id: "roo",
        aliases: &["roo-code"],
        display_name: "Roo Code",
        project_skills_dir: ".roo/skills",
        global_skills_dir: ".roo/skills",
        global_detect_markers: &[".roo"],
        project_detect_markers: &[".roo"],
    },
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkillSource {
    Bundled,
    Local(PathBuf),
    GitHub { slug: String, url: String },
    GitUrl(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct SkillsLock {
    pub version: u32,
    #[serde(default)]
    pub entries: Vec<SkillLockEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillLockEntry {
    pub name: String,
    pub scope: String,
    pub source: String,
    pub agents: Vec<String>,
    pub path: String,
    pub sha256: String,
    pub updated_at: String,
}

pub fn find_agent_spec(input: &str) -> Result<&'static AgentSpec> {
    let needle = input.trim().to_ascii_lowercase();
    if needle.is_empty() {
        return Err(Error::with_code(
            "HARNESS_E_USAGE",
            "Agent name cannot be empty.",
        ));
    }
    SUPPORTED_AGENTS
        .iter()
        .find(|spec| {
            spec.id == needle
                || spec
                    .aliases
                    .iter()
                    .any(|alias| alias.eq_ignore_ascii_case(&needle))
        })
        .ok_or_else(|| {
            let valid: Vec<_> = SUPPORTED_AGENTS.iter().map(|s| s.id).collect();
            Error::with_code(
                "HARNESS_E_USAGE",
                format!(
                    "Unknown agent \"{input}\". Supported agents: {}",
                    valid.join(", ")
                ),
            )
        })
}

pub fn validate_skill_name(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            format!("Invalid skill name \"{raw}\": must be 1..=64 characters."),
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.starts_with('.') {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            format!("Invalid skill name \"{raw}\": cannot start with '.'."),
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            format!("Invalid skill name \"{raw}\": path separators are not allowed."),
        ));
    }
    let valid = trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !valid {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            format!(
                "Invalid skill name \"{raw}\": use lowercase ASCII letters, digits, '-' or '_'."
            ),
        ));
    }
    Ok(trimmed.to_string())
}

/// Extract `name` and `description` from a `SKILL.md` YAML frontmatter block.
/// Supports folded (`>-`, `>`) and literal (`|`) YAML description scalars.
pub fn parse_skill_metadata(markdown: &str, fallback_name: Option<&str>) -> Result<SkillMeta> {
    let normalized = markdown.replace("\r\n", "\n");
    let mut name: Option<String> = None;
    let mut description_lines: Vec<String> = Vec::new();
    let mut reading_desc = false;

    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some((frontmatter, _body)) = rest.split_once("\n---") {
            for line in frontmatter.lines() {
                if reading_desc {
                    if line.starts_with(' ') || line.starts_with('\t') || line.trim().is_empty() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            description_lines.push(trimmed.to_string());
                        }
                        continue;
                    }
                    reading_desc = false;
                }
                if let Some((key, val)) = line.split_once(':') {
                    let key = key.trim();
                    let val = val.trim();
                    if key == "name" {
                        let unquoted = val.trim_matches('"').trim_matches('\'').trim();
                        if !unquoted.is_empty() {
                            name = Some(unquoted.to_string());
                        }
                    } else if key == "description" {
                        if matches!(val, ">-" | ">" | "|-" | "|") {
                            reading_desc = true;
                        } else {
                            let unquoted = val.trim_matches('"').trim_matches('\'').trim();
                            if !unquoted.is_empty() {
                                description_lines.push(unquoted.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let resolved_name = match name {
        Some(raw) => validate_skill_name(&raw)?,
        None => match fallback_name {
            Some(fb) => validate_skill_name(fb)?,
            None => {
                return Err(Error::with_code(
                    "HARNESS_E_VALIDATION",
                    "SKILL.md is missing frontmatter `name:` field.",
                ))
            }
        },
    };
    Ok(SkillMeta {
        name: resolved_name,
        description: description_lines.join(" "),
    })
}

pub fn resolve_user_home() -> PathBuf {
    if let Ok(override_home) = env::var("HARNESS_AGENT_HOME") {
        let trimmed = override_home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    #[cfg(windows)]
    {
        env::var("USERPROFILE")
            .or_else(|_| env::var("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        env::var("HOME")
            .or_else(|_| env::var("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

pub fn skills_lock_file_path(harness_home: &Path) -> PathBuf {
    harness_home.join("skills-lock.json")
}

pub fn classify_skill_source(raw: Option<&str>, cwd: &Path) -> Result<SkillSource> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(SkillSource::Bundled);
    };
    if raw.eq_ignore_ascii_case("harness") || raw.eq_ignore_ascii_case("5harness") {
        return Ok(SkillSource::Bundled);
    }
    if raw.starts_with('-') {
        return Err(Error::with_code(
            "HARNESS_E_USAGE",
            format!("Invalid skill source \"{raw}\": sources cannot start with '-'."),
        ));
    }
    if raw.contains('\0') || raw.chars().any(|c| c.is_control()) {
        return Err(Error::with_code(
            "HARNESS_E_USAGE",
            "Skill source contains invalid characters.",
        ));
    }

    if raw.starts_with("https://") {
        let parsed = Url::parse(raw).map_err(|err| {
            Error::with_code(
                "HARNESS_E_USAGE",
                format!("Invalid skill URL \"{raw}\": {err}"),
            )
        })?;
        if parsed.scheme() != "https"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(Error::with_code(
                "HARNESS_E_USAGE",
                "Remote skill URLs must use HTTPS without embedded credentials.",
            ));
        }
        return Ok(SkillSource::GitUrl(raw.to_string()));
    }
    if raw.starts_with("http://") || raw.starts_with("ssh://") || raw.starts_with("git@") {
        return Err(Error::with_code(
            "HARNESS_E_USAGE",
            format!(
                "Unsupported skill URL scheme \"{raw}\": use `owner/repo`, a local path, or `https://...`."
            ),
        ));
    }

    let looks_local = raw.starts_with('.')
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.starts_with('~')
        || raw.contains('\\')
        || (raw.len() >= 2 && raw.as_bytes()[1] == b':');
    if looks_local {
        let resolved = crate::domain::paths::resolve_target_dir(Some(raw), cwd);
        return Ok(SkillSource::Local(resolved));
    }

    let candidate_local = cwd.join(raw);
    if candidate_local.exists() {
        return Ok(SkillSource::Local(candidate_local));
    }

    if let Some((owner, repo)) = raw.split_once('/') {
        let valid_part = |s: &str| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && !s.starts_with('-')
                && !s.starts_with('.')
                && s.len() <= 100
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        };
        if !owner.contains('/') && !repo.contains('/') && valid_part(owner) && valid_part(repo) {
            let clean_repo = repo.strip_suffix(".git").unwrap_or(repo);
            let slug = format!("{owner}/{clean_repo}");
            let url = format!("https://github.com/{slug}.git");
            return Ok(SkillSource::GitHub { slug, url });
        }
    }

    Err(Error::with_code(
        "HARNESS_E_USAGE",
        format!(
            "Could not resolve skill source \"{raw}\". Use omitted/`harness` for the built-in 5harness skill, a local path, `<owner>/<repo>`, or an `https://` Git repository URL."
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_skill_names_and_rejects_traversal() {
        assert_eq!(validate_skill_name("harness").unwrap(), "harness");
        assert_eq!(
            validate_skill_name("my_skill-1").unwrap(),
            "my_skill-1".to_string()
        );
        assert!(validate_skill_name("../escape").is_err());
        assert!(validate_skill_name("a/b").is_err());
        assert!(validate_skill_name(".hidden").is_err());
        assert!(validate_skill_name("BadCase").is_err());
    }

    #[test]
    fn parses_bundled_skill_frontmatter() {
        let meta = parse_skill_metadata(BUNDLED_HARNESS_SKILL_MD, None).unwrap();
        assert_eq!(meta.name, "harness");
        assert!(meta.description.contains("5harness"));
    }

    #[test]
    fn classifies_bundled_local_github_and_rejects_unsafe_schemes() {
        let cwd = Path::new("/tmp/ws");
        assert_eq!(
            classify_skill_source(None, cwd).unwrap(),
            SkillSource::Bundled
        );
        assert_eq!(
            classify_skill_source(Some("harness"), cwd).unwrap(),
            SkillSource::Bundled
        );
        assert_eq!(
            classify_skill_source(Some("vercel-labs/agent-skills"), cwd).unwrap(),
            SkillSource::GitHub {
                slug: "vercel-labs/agent-skills".into(),
                url: "https://github.com/vercel-labs/agent-skills.git".into()
            }
        );
        assert!(classify_skill_source(Some("http://insecure.example/repo"), cwd).is_err());
        assert!(classify_skill_source(Some("--upload-pack=bad"), cwd).is_err());
    }
}
