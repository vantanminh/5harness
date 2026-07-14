import { laneDisplay, proofDisplay } from "../domain/enums.js";
import { asString } from "../domain/frontmatter.js";
import { formatTable } from "../infrastructure/table.js";
import { buildCatalog, proof01, type ProjectCatalog } from "./catalog.js";
import { listLocalTraces } from "./local-traces.js";

export function queryMatrixMd(
  projectRoot: string,
  numeric = false,
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  const rows = cat.byType.story.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    unit: proofDisplay(proof01(e.data, "unit"), numeric),
    integ: proofDisplay(proof01(e.data, "integration"), numeric),
    e2e: proofDisplay(proof01(e.data, "e2e"), numeric),
    plat: proofDisplay(proof01(e.data, "platform"), numeric),
    evidence: asString(e.data, "evidence") ?? "",
  }));
  return formatTable(rows, [
    "id",
    "title",
    "status",
    "unit",
    "integ",
    "e2e",
    "plat",
    "evidence",
  ]);
}

export function queryStoriesMd(
  projectRoot: string,
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  const rows = cat.byType.story.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    lane: laneDisplay(asString(e.data, "lane") ?? "normal"),
    contract: asString(e.data, "contract") ?? "",
  }));
  return formatTable(rows, ["id", "title", "status", "lane", "contract"]);
}

export function queryStatsMd(
  projectRoot: string,
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  const traces = listLocalTraces(projectRoot).length;
  const lines = [
    "=== Harness Stats ===",
    formatTable(
      [
        {
          intakes: cat.byType.intake.length,
          stories: cat.byType.story.length,
          decisions: cat.byType.decision.length,
          backlog_items: cat.byType.backlog.length,
          reports: cat.byType.report.length,
          traces,
        },
      ],
      ["intakes", "stories", "decisions", "backlog_items", "reports", "traces"],
    ),
  ];
  return lines.join("\n");
}

export function queryIntakesMd(
  projectRoot: string,
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  const rows = [...cat.byType.intake]
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      created_at: asString(e.data, "created_at") ?? "",
      input_type: asString(e.data, "input_type") ?? "",
      risk_lane: laneDisplay(asString(e.data, "lane") ?? "normal"),
      summary: asString(e.data, "summary") ?? e.title,
    }));
  return formatTable(rows, [
    "id",
    "created_at",
    "input_type",
    "risk_lane",
    "summary",
  ]);
}

export function queryDecisionsMd(
  projectRoot: string,
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  const rows = cat.byType.decision.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    doc: asString(e.data, "doc") ?? e.path,
    last_verified_at: asString(e.data, "last_verified_at") ?? "",
    last_verified_result: asString(e.data, "last_verified_result") ?? "",
  }));
  return formatTable(rows, [
    "id",
    "title",
    "status",
    "doc",
    "last_verified_at",
    "last_verified_result",
  ]);
}

export function queryBacklogMd(
  projectRoot: string,
  filter: "all" | "open" | "closed" = "all",
  catalog?: ProjectCatalog,
): string {
  const cat = catalog ?? buildCatalog(projectRoot);
  let items = cat.byType.backlog;
  if (filter === "open") {
    items = items.filter(
      (e) => e.status === "proposed" || e.status === "accepted",
    );
  } else if (filter === "closed") {
    items = items.filter(
      (e) => e.status === "implemented" || e.status === "rejected",
    );
  }
  const rows = [...items]
    .sort((a, b) => b.id.localeCompare(a.id))
    .map((e) => {
      const risk = asString(e.data, "risk");
      return {
        id: e.id,
        title: e.title,
        risk: risk ? laneDisplay(risk) : "",
        status: e.status,
        predicted: asString(e.data, "predicted") ?? "",
        outcome: asString(e.data, "outcome") ?? "",
      };
    });
  return formatTable(rows, [
    "id",
    "title",
    "risk",
    "status",
    "predicted",
    "outcome",
  ]);
}
