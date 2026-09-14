export interface DashboardSummary {
  totalRecords: number;
  searchableRecords: number;
  excludedRecords: number;
  searchableRate: number;
  uniqueMaterials: number;
  duplicateRows: number;
  plants: number;
  classes: number;
  embeddedRecords: number;
  embeddingCoverage: number;
  matchReadiness: number;
}

export interface DistributionItem {
  label: string;
  count: number;
  percentage: number;
  active?: number;
  inactive?: number;
  readiness?: number;
}

export interface QualityMetric {
  key: string;
  label: string;
  count: number;
  percentage: number;
  critical: boolean;
}

export interface DashboardInsight {
  severity: "critical" | "warning" | "positive" | "info";
  title: string;
  description: string;
  value: string;
}

export interface DashboardAnalytics {
  generatedAt: string;
  upload: {
    fileName: string;
    sheetName: string;
    rowCount: number;
    activeCount: number;
    createdAt: string;
  } | null;
  summary: DashboardSummary;
  statusDistribution: DistributionItem[];
  classDistribution: DistributionItem[];
  plantDistribution: DistributionItem[];
  materialTypeDistribution: DistributionItem[];
  qualityMetrics: QualityMetric[];
  readinessDistribution: DistributionItem[];
  insights: DashboardInsight[];
}
