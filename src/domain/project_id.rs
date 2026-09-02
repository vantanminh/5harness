use crate::error::{Error, Result};

use super::upgrade::{extract_harness_block, HARNESS_BEGIN};

const PROJECT_ID_RE: &str = r"<!--\s*harness-project-id:\s*([A-Za-z0-9_-]+)\s*-->";

pub fn parse_project_id(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.len() < 16
        || value.len() > 64
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(Error::new(format!(
            "Invalid harness project id \"{raw}\". Expected 16-64 letters, numbers, _ or -."
        )));
    }
    Ok(value.to_string())
}

pub fn generate_project_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("rng");
    hex::encode(bytes)
}

pub fn extract_project_id(agents_text: &str) -> Option<String> {
    let block = extract_harness_block(agents_text)?;
    let re = regex::Regex::new(PROJECT_ID_RE).ok()?;
    re.captures(&block.block)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

pub fn insert_project_id_marker(agents_text: &str, project_id: &str) -> Result<String> {
    parse_project_id(project_id)?;
    if extract_project_id(agents_text).is_some() {
        return Ok(agents_text.to_string());
    }
    let extracted = extract_harness_block(agents_text).ok_or_else(|| {
        Error::new("AGENTS.md has no harness-managed block. Run `harness init --force` first.")
    })?;
    let newline = if extracted.block.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let marker = format!("<!-- harness-project-id: {project_id} -->");
    let version_re = regex::Regex::new(r"(?m)^(<!--\s*harness-version:[^\r\n]*-->)").unwrap();
    let updated_block = if version_re.is_match(&extracted.block) {
        version_re
            .replace(&extracted.block, format!("$1{newline}{marker}"))
            .into_owned()
    } else {
        extracted
            .block
            .replacen(HARNESS_BEGIN, &format!("{HARNESS_BEGIN}{newline}{marker}"), 1)
    };
    Ok(format!(
        "{}{}{}",
        extracted.before, updated_block, extracted.after
    ))
}
