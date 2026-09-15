import ExcelJS from "exceljs";
import { z } from "zod";

export const runtime = "nodejs";

const comparisonSchema = z.object({ label: z.string(), query: z.string(), candidate: z.string(), state: z.string() });
const matchSchema = z.object({
  rank: z.number(),
  corporateNo: z.string(),
  sapNo: z.string(),
  plant: z.string(),
  className: z.string(),
  confidence: z.number(),
  parametricScore: z.number(),
  semanticScore: z.number(),
  shortDescription: z.string(),
  longDescription: z.string(),
  status: z.string(),
  comparisons: z.array(comparisonSchema),
  mismatches: z.array(z.string()),
});
const bodySchema = z.union([
  z.object({ query: z.string(), matches: z.array(matchSchema).max(10) }),
  z.object({ results: z.array(z.object({ query: z.string(), matches: z.array(matchSchema).max(10) })).min(1).max(50) }),
]);

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.parse(await request.json());
    const groups = "results" in parsed ? parsed.results : [parsed];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Material Match AI";
    const summary = workbook.addWorksheet("Matches");
    summary.columns = [
      { header: "Query", key: "sourceQuery", width: 36 },
      { header: "Rank", key: "rank", width: 8 },
      { header: "Confidence", key: "confidence", width: 14 },
      { header: "Corporate No", key: "corporateNo", width: 20 },
      { header: "SAP No", key: "sapNo", width: 24 },
      { header: "Plant", key: "plant", width: 12 },
      { header: "Class", key: "className", width: 26 },
      { header: "Short Description", key: "shortDescription", width: 48 },
      { header: "Status", key: "status", width: 22 },
      { header: "Parametric Score", key: "parametricScore", width: 18 },
      { header: "Semantic Score", key: "semanticScore", width: 18 },
      { header: "Differences", key: "differences", width: 60 },
    ];
    groups.forEach((group) => group.matches.forEach((match) => summary.addRow({ ...match, sourceQuery: group.query, confidence: `${match.confidence}%`, parametricScore: `${match.parametricScore}%`, semanticScore: `${match.semanticScore}%`, differences: match.mismatches.join(" | ") })));
    summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15362F" } };
    summary.views = [{ state: "frozen", ySplit: 1 }];
    const details = workbook.addWorksheet("Attribute comparison");
    details.columns = [
      { header: "Query", key: "sourceQuery", width: 36 },
      { header: "Rank", key: "rank", width: 8 },
      { header: "SAP No", key: "sapNo", width: 24 },
      { header: "Attribute", key: "attribute", width: 24 },
      { header: "Query value", key: "query", width: 32 },
      { header: "Candidate", key: "candidate", width: 42 },
      { header: "Result", key: "result", width: 16 },
    ];
    groups.forEach((group) => group.matches.forEach((match) => match.comparisons.forEach((comparison) => details.addRow({ sourceQuery: group.query, rank: match.rank, sapNo: match.sapNo, attribute: comparison.label, query: comparison.query, candidate: comparison.candidate, result: comparison.state }))));
    details.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    details.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15362F" } };
    details.views = [{ state: "frozen", ySplit: 1 }];
    if (!("results" in parsed)) {
      summary.insertRow(1, ["Search query", parsed.query]);
      summary.mergeCells("B1:L1");
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="material-matches-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch {
    return Response.json({ error: "The results could not be exported" }, { status: 400 });
  }
}
