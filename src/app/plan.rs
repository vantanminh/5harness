//! Cloud implementation briefs handed from a web AI to a coding agent.
//!
//! A brief is stored in Harness Cloud under the authenticated account and
//! addressed by an opaque token. Web AIs create it through hosted MCP; coding
//! agents load the full prompt with `harness plan get <token>`.

use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::app::auth;
use crate::error::{Error, Result};

pub const PLAN_TOKEN_MIN: usize = 12;
pub const PLAN_TOKEN_MAX: usize = 32;
pub const HANDOFF_PREFIX: &str = "please implement plan from harness --";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanRecord {
    pub token: String,
    pub project_id: String,
    pub title: String,
    pub idea: String,
    #[serde(default)]
    pub research_notes: String,
    pub plan_markdown: String,
    pub implement_prompt: String,
    pub handoff_command: String,
    pub created_at: String,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
}

pub fn validate_plan_token(raw: &str) -> Result<String> {
    let token = raw
        .trim()
        .trim_start_matches('-')
        .trim()
        .to_ascii_lowercase();
    if token.len() < PLAN_TOKEN_MIN
        || token.len() > PLAN_TOKEN_MAX
        || !token
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
    {
        return Err(Error::new(
            "Plan token must be 12-32 lowercase letters or digits (the value after `--` in the handoff command).",
        ));
    }
    Ok(token)
}

pub fn handoff_command(token: &str) -> String {
    format!("{HANDOFF_PREFIX}{token}")
}

pub fn parse_handoff_token(text: &str) -> Result<String> {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix(HANDOFF_PREFIX) {
        return validate_plan_token(rest.split_whitespace().next().unwrap_or(rest));
    }
    validate_plan_token(trimmed)
}

pub fn format_plan_for_agent(plan: &PlanRecord) -> String {
    format!(
        "Harness implementation brief {}\nProject: {}\nTitle: {}\nHandoff: {}\nCreated: {}\n\n## Original idea\n{}\n\n## Research notes\n{}\n\n## Plan\n{}\n\n## Coding-agent prompt\n{}\n",
        plan.token,
        plan.project_id,
        plan.title,
        plan.handoff_command,
        plan.created_at,
        plan.idea,
        if plan.research_notes.trim().is_empty() {
            "(none)"
        } else {
            plan.research_notes.as_str()
        },
        plan.plan_markdown,
        plan.implement_prompt
    )
}

pub fn fetch_plan(token_input: &str) -> Result<PlanRecord> {
    let token = parse_handoff_token(token_input)?;
    let (access, auth_state) = auth::access_token()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Error::new(format!("HTTP client initialization failed: {e}")))?;
    let response = client
        .get(auth::api_url(
            &auth_state.server,
            &format!("/plans/{token}"),
        ))
        .bearer_auth(access)
        .send()
        .map_err(|e| Error::new(format!("Harness cloud plan download failed: {e}")))?;
    if response.status().as_u16() == 404 {
        return Err(Error::new(format!(
            "No cloud plan exists for token {token} on this account."
        )));
    }
    if !response.status().is_success() {
        return Err(Error::new(format!(
            "Harness cloud plan download rejected (HTTP {}). Run `harness login` and retry.",
            response.status().as_u16()
        )));
    }
    let plan: PlanRecord = response
        .json()
        .map_err(|e| Error::new(format!("Invalid plan response from Harness cloud: {e}")))?;
    if plan.token != token {
        return Err(Error::new(
            "Cloud plan token did not match the requested identifier.",
        ));
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_handoff_command_and_bare_token() {
        let token = "kfkadjakdnjkad";
        assert_eq!(validate_plan_token(token).unwrap(), token);
        assert_eq!(parse_handoff_token(&handoff_command(token)).unwrap(), token);
        assert_eq!(parse_handoff_token(&format!("--{token}")).unwrap(), token);
        assert_eq!(
            validate_plan_token("HasCapitals12").unwrap(),
            "hascapitals12"
        );
        assert!(validate_plan_token("short").is_err());
        assert!(validate_plan_token("has_underscore1").is_err());
        assert_eq!(
            handoff_command(token),
            "please implement plan from harness --kfkadjakdnjkad"
        );
    }

    #[test]
    fn agent_view_includes_full_prompt_and_plan() {
        let plan = PlanRecord {
            token: "kfkadjakdnjkad".into(),
            project_id: "project-1234567890abcd".into(),
            title: "Export API".into(),
            idea: "Add an export endpoint".into(),
            research_notes: "Looked at similar CLIs".into(),
            plan_markdown: "1. Add route\n2. Test".into(),
            implement_prompt: "Implement the export API as specified.".into(),
            handoff_command: handoff_command("kfkadjakdnjkad"),
            created_at: "2026-09-16T00:00:00Z".into(),
            created_by: Some("user@example.com".into()),
            client_name: Some("chatgpt".into()),
        };
        let text = format_plan_for_agent(&plan);
        assert!(text.contains("Implement the export API as specified."));
        assert!(text.contains("1. Add route"));
        assert!(text.contains("please implement plan from harness --kfkadjakdnjkad"));
        assert!(text.contains("project-1234567890abcd"));
    }
}
