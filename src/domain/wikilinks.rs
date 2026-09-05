use regex::Regex;

pub fn extract_wikilinks(text: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(text)
        .filter_map(|c| c.get(1))
        .map(|m| normalize_link_target(m.as_str().split('|').next().unwrap_or("").trim()))
        .filter(|target| !is_placeholder_target(target))
        .filter(|s| !s.is_empty())
        .collect()
}

fn is_placeholder_target(target: &str) -> bool {
    matches!(target, "…" | "..." | "type/id")
}

pub fn normalize_link_target(raw: &str) -> String {
    let mut t = raw.trim().replace('\\', "/");
    if let Some(stripped) = t.strip_prefix("./") {
        t = stripped.to_string();
    }
    if let Some(stripped) = t.strip_suffix(".md") {
        t = stripped.to_string();
    }
    t
}

pub fn match_link_target<'a>(
    target: &str,
    entries: &'a [(String, String, String)],
) -> Option<&'a (String, String, String)> {
    let norm = normalize_link_target(target);
    for e in entries {
        let p = e.1.replace('\\', "/").trim_end_matches(".md").to_string();
        if p == norm || p.ends_with(&format!("/{norm}")) {
            return Some(e);
        }
        if e.0 == norm {
            return Some(e);
        }
        // Legacy decisions were often referenced by their numeric filename
        // prefix (for example `0021`) while the inferred catalog id is the
        // full stem (`0021-internal-cli-parser`). Preserve that shorthand.
        let stem = p.rsplit('/').next().unwrap_or(&p);
        if stem
            .split_once('-')
            .is_some_and(|(prefix, _)| prefix == norm)
        {
            return Some(e);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{extract_wikilinks, match_link_target};

    #[test]
    fn ignores_documentation_placeholder_wikilinks() {
        assert!(extract_wikilinks("[[…]] [[type/id]] [[US-001]]").eq(&["US-001"]));
    }

    #[test]
    fn matches_legacy_numeric_filename_prefix() {
        let entries = vec![(
            "0021-internal-cli-parser".to_string(),
            "docs/decisions/0021-internal-cli-parser.md".to_string(),
            "decision".to_string(),
        )];
        assert_eq!(
            match_link_target("0021", &entries).map(|entry| entry.0.as_str()),
            Some("0021-internal-cli-parser")
        );
    }
}
