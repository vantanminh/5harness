pub const HARNESS_BEGIN: &str = "<!-- HARNESS:BEGIN -->";
pub const HARNESS_END: &str = "<!-- HARNESS:END -->";

pub struct HarnessBlock {
    pub before: String,
    pub block: String,
    pub after: String,
}

pub fn extract_harness_block(agents_text: &str) -> Option<HarnessBlock> {
    let begin_idx = agents_text.find(HARNESS_BEGIN)?;
    let end_idx = agents_text.rfind(HARNESS_END)?;
    if end_idx <= begin_idx {
        return None;
    }
    let block_end = end_idx + HARNESS_END.len();
    Some(HarnessBlock {
        before: agents_text[..begin_idx].to_string(),
        block: agents_text[begin_idx..block_end].to_string(),
        after: agents_text[block_end..].to_string(),
    })
}

pub fn replace_harness_block(target_text: &str, new_block: &str) -> String {
    if let Some(extracted) = extract_harness_block(target_text) {
        format!("{}{}{}", extracted.before, new_block, extracted.after)
    } else {
        format!("{}\n\n{new_block}\n", target_text.trim_end())
    }
}

pub fn remove_harness_block(agents_text: &str) -> String {
    let Some(extracted) = extract_harness_block(agents_text) else {
        return agents_text.to_string();
    };
    let joined = format!(
        "{}\n{}",
        extracted.before.trim_end(),
        extracted.after.trim_start()
    );
    let collapsed = regex::Regex::new(r"\n{3,}")
        .unwrap()
        .replace_all(&joined, "\n\n");
    format!("{}\n", collapsed.trim_end())
}

pub fn extract_repo_version(agents_text: &str) -> Option<String> {
    let re = regex::Regex::new(r"<!--\s*harness-version:\s*([^\s-]+)\s*-->").ok()?;
    re.captures(agents_text)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
}
