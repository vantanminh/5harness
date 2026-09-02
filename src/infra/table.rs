pub fn format_table(rows: &[Vec<String>], columns: &[&str]) -> String {
    if rows.is_empty() {
        let header = columns.join("  ");
        let sep = columns.iter().map(|_| "--").collect::<Vec<_>>().join("  ");
        return format!("{header}\n{sep}");
    }
    let mut widths: Vec<usize> = columns.iter().map(|c| c.len().max(2)).collect();
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            if i < widths.len() {
                widths[i] = widths[i].max(cell.len());
            }
        }
    }
    let pad = |cells: &[String]| {
        cells
            .iter()
            .enumerate()
            .map(|(i, cell)| {
                let w = widths.get(i).copied().unwrap_or(cell.len());
                format!("{cell:<w$}")
            })
            .collect::<Vec<_>>()
            .join("  ")
    };
    let header = pad(
        &columns
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>(),
    );
    let sep = widths
        .iter()
        .map(|w| "-".repeat(*w))
        .collect::<Vec<_>>()
        .join("  ");
    let body = rows
        .iter()
        .map(|r| pad(r))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{header}\n{sep}\n{body}")
}
