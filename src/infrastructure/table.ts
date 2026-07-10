export function formatTable(
  rows: Array<Record<string, string | number | null | undefined>>,
  columns: string[],
): string {
  if (rows.length === 0) {
    return columns.join("  ") + "\n" + columns.map(() => "--").join("  ");
  }

  const stringRows = rows.map((row) =>
    columns.map((col) => {
      const value = row[col];
      if (value === null || value === undefined) return "";
      return String(value);
    }),
  );

  const widths = columns.map((col, i) =>
    Math.max(
      col.length,
      ...stringRows.map((r) => r[i]?.length ?? 0),
      2,
    ),
  );

  const pad = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");

  const header = pad(columns);
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = stringRows.map((r) => pad(r)).join("\n");
  return `${header}\n${sep}\n${body}`;
}
