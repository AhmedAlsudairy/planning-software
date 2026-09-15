import type { DashboardInsight, DashboardSummary, DistributionItem, QualityMetric } from "@/types/dashboard";

export function percentage(value: number, total: number): number {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

export function buildDashboardInsights(summary: DashboardSummary, quality: QualityMetric[], classes: DistributionItem[]): DashboardInsight[] {
  const insights: DashboardInsight[] = [];
  if (summary.embeddingCoverage < 80) {
    insights.push({
      severity: summary.embeddingCoverage < 25 ? "critical" : "warning",
      title: "Semantic index coverage is low",
      description: "Records without embeddings can participate in rule and text retrieval, but not full-dataset semantic retrieval.",
      value: `${summary.embeddingCoverage}%`,
    });
  } else {
    insights.push({ severity: "positive", title: "Semantic index is healthy", description: "Most searchable records have Gemini embeddings available for semantic retrieval.", value: `${summary.embeddingCoverage}%` });
  }
  const excludedRate = percentage(summary.excludedRecords, summary.totalRecords);
  if (summary.excludedRecords) {
    insights.push({
      severity: excludedRate >= 20 ? "warning" : "info",
      title: "Inactive records are intentionally excluded",
      description: "Deleted and deletion-staged records remain auditable in Neon but do not enter normal matching.",
      value: `${excludedRate}%`,
    });
  }
  const lowestCritical = quality.filter((metric) => metric.critical).sort((left, right) => left.percentage - right.percentage)[0];
  if (lowestCritical) {
    insights.push({
      severity: lowestCritical.percentage < 40 ? "critical" : "warning",
      title: `${lowestCritical.label} needs enrichment`,
      description: "Low coverage of a critical engineering attribute reduces confidence and produces more manual-review candidates.",
      value: `${lowestCritical.percentage}%`,
    });
  }
  if (summary.duplicateRows) {
    insights.push({
      severity: "info",
      title: "Plant-level duplicates detected",
      description: "The same corporate/SAP material appears in multiple plant rows. Search collapses these into one ranked material.",
      value: summary.duplicateRows.toLocaleString("en-IN"),
    });
  }
  if (summary.duplicateDescriptionRows) {
    insights.push({
      severity: "warning",
      title: "Repeated descriptions need review",
      description: "Multiple searchable records share the exact same normalized long description, which can indicate duplicate codes or legitimate plant variants.",
      value: summary.duplicateDescriptionRows.toLocaleString("en-IN"),
    });
  }
  const provisionalRate = percentage(summary.provisionalSapRecords, summary.totalRecords);
  if (summary.provisionalSapRecords) {
    insights.push({
      severity: provisionalRate >= 15 ? "warning" : "info",
      title: "Provisional SAP codes remain",
      description: "NIR identifiers represent records that may not yet have a final numeric ERP material code.",
      value: `${provisionalRate}%`,
    });
  }
  if (summary.matchReadiness < 60) {
    insights.push({
      severity: summary.matchReadiness < 40 ? "critical" : "warning",
      title: "Overall match readiness is limited",
      description: "Prioritize critical attribute enrichment by class before treating confidence scores as automation decisions.",
      value: `${summary.matchReadiness}%`,
    });
  }
  const topClass = classes[0];
  if (topClass) {
    insights.push({ severity: "positive", title: `${topClass.label} is the largest class`, description: "Prioritize a class-specific parser and evaluation set here for the highest immediate accuracy impact.", value: `${topClass.percentage}%` });
  }
  return insights.slice(0, 8);
}
