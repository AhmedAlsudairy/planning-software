import { describe, expect, it } from "vitest";
import { buildDashboardInsights, percentage } from "@/lib/dashboard";
import type { DashboardSummary, QualityMetric } from "@/types/dashboard";

const summary: DashboardSummary = {
  totalRecords: 20_000,
  searchableRecords: 15_661,
  excludedRecords: 4_339,
  searchableRate: 78.3,
  uniqueMaterials: 19_982,
  duplicateRows: 18,
  plants: 12,
  classes: 400,
  embeddedRecords: 100,
  embeddingCoverage: 0.6,
  matchReadiness: 52,
  numericSapRecords: 15_000,
  provisionalSapRecords: 4_000,
  otherSapRecords: 1_000,
  missingSapRecords: 0,
  genericClassRecords: 100,
  duplicateDescriptionGroups: 250,
  duplicateDescriptionRows: 400,
  averageDescriptionLength: 120,
  datedRecords: 19_000,
};

const quality: QualityMetric[] = [
  { key: "size", label: "Size / DN", count: 4_000, percentage: 25.5, critical: true },
  { key: "description", label: "Long description", count: 15_000, percentage: 95.8, critical: true },
];

describe("dashboard analysis", () => {
  it("calculates stable percentages", () => {
    expect(percentage(4_339, 20_000)).toBe(21.7);
    expect(percentage(0, 0)).toBe(0);
  });

  it("surfaces semantic, status, quality, and duplicate risks", () => {
    const insights = buildDashboardInsights(summary, quality, [{ label: "VALVE", count: 1_000, percentage: 5, readiness: 60 }]);
    expect(insights.map((insight) => insight.title)).toEqual(expect.arrayContaining([
      "Semantic index coverage is low",
      "Inactive records are intentionally excluded",
      "Size / DN needs enrichment",
      "Plant-level duplicates detected",
      "Repeated descriptions need review",
      "Provisional SAP codes remain",
      "Overall match readiness is limited",
    ]));
  });
});
