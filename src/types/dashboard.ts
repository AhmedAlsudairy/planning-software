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
  numericSapRecords: number;
  provisionalSapRecords: number;
  otherSapRecords: number;
  missingSapRecords: number;
  genericClassRecords: number;
  duplicateDescriptionGroups: number;
  duplicateDescriptionRows: number;
  averageDescriptionLength: number;
  datedRecords: number;
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

export interface ClassQualityItem {
  label: string;
  count: number;
  active: number;
  readiness: number;
  sizeCoverage: number;
  pressureCoverage: number;
  connectionCoverage: number;
  materialCoverage: number;
  standardCoverage: number;
}

export interface PlantHealthItem {
  label: string;
  count: number;
  searchable: number;
  excluded: number;
  searchableRate: number;
  readiness: number;
}

export interface MissingPattern {
  label: string;
  count: number;
  percentage: number;
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
  sapMaturityDistribution: DistributionItem[];
  descriptionLengthDistribution: DistributionItem[];
  createdYearDistribution: DistributionItem[];
  classQuality: ClassQualityItem[];
  plantHealth: PlantHealthItem[];
  missingPatterns: MissingPattern[];
  insights: DashboardInsight[];
}
