use crate::error::{Error, Result};

pub const RISK_LANES: &[&str] = &["tiny", "normal", "high_risk"];
pub const INTAKE_STATUSES: &[&str] = &["pending", "completed", "dismissed"];
pub const STORY_STATUSES: &[&str] = &[
    "planned",
    "in_progress",
    "implemented",
    "blocked",
    "changed",
    "retired",
];
pub const DECISION_STATUSES: &[&str] = &["proposed", "accepted", "superseded", "rejected"];
pub const BACKLOG_STATUSES: &[&str] = &["proposed", "accepted", "implemented", "rejected"];

fn slugify(raw: &str) -> String {
    let s = raw.trim().to_lowercase();
    let mut out = String::new();
    let mut prev_us = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_us = false;
        } else if (ch == ' ' || ch == '-' || ch == '_') && !prev_us && !out.is_empty() {
            out.push('_');
            prev_us = true;
        }
    }
    out
}

pub fn parse_risk_lane(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    let lane = if normalized == "highrisk" || normalized == "high_risk" {
        "high_risk".to_string()
    } else {
        normalized
    };
    if RISK_LANES.contains(&lane.as_str()) {
        Ok(lane)
    } else {
        Err(Error::new(format!(
            "Invalid risk lane \"{raw}\". Use tiny | normal | high-risk"
        )))
    }
}

pub fn parse_input_type(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    let value = match normalized.as_str() {
        "new_spec" => "new_spec",
        "spec_slice" => "spec_slice",
        "change_request" => "change_request",
        "new_initiative" => "new_initiative",
        "maintenance" | "maintenance_request" => "maintenance",
        "harness_improvement" => "harness_improvement",
        _ => {
            return Err(Error::new(format!(
                "Invalid input type \"{raw}\". Use new_spec | spec_slice | change_request | new_initiative | maintenance | harness_improvement"
            )))
        }
    };
    Ok(value.to_string())
}

pub fn parse_intake_status(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    if INTAKE_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid intake status \"{raw}\". Use {}",
            INTAKE_STATUSES.join(" | ")
        )))
    }
}

pub fn parse_story_status(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    if STORY_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid story status \"{raw}\". Use {}",
            STORY_STATUSES.join(" | ")
        )))
    }
}

pub fn parse_decision_status(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    if DECISION_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid decision status \"{raw}\". Use {}",
            DECISION_STATUSES.join(" | ")
        )))
    }
}

pub fn parse_backlog_status(raw: &str) -> Result<String> {
    let normalized = slugify(raw);
    if BACKLOG_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid backlog status \"{raw}\". Use {}",
            BACKLOG_STATUSES.join(" | ")
        )))
    }
}

pub fn parse_proof_flag(raw: &str, field: &str) -> Result<i64> {
    match raw.trim() {
        "0" | "false" | "no" => Ok(0),
        "1" | "true" | "yes" => Ok(1),
        _ => Err(Error::new(format!(
            "Invalid {field} proof flag \"{raw}\". Use 0 or 1"
        ))),
    }
}

pub fn lane_display(lane: &str) -> String {
    if lane == "high_risk" {
        "high-risk".to_string()
    } else {
        lane.to_string()
    }
}

pub fn proof_display(value: i64, numeric: bool) -> String {
    if numeric {
        value.to_string()
    } else if value == 1 {
        "yes".to_string()
    } else {
        "no".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_spec_slice_alias() {
        assert_eq!(parse_input_type("spec-slice").unwrap(), "spec_slice");
        assert_eq!(parse_risk_lane("high-risk").unwrap(), "high_risk");
    }
}
