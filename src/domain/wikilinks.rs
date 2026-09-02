use regex::Regex;

pub fn extract_wikilinks(text: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(text)
        .filter_map(|c| c.get(1))
        .map(|m| normalize_link_target(m.as_str().split('|').next().unwrap_or("").trim()))
        .filter(|s| !s.is_empty())
        .collect()
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
    }
    None
}
