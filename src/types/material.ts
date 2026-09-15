export type MatchState = "exact" | "compatible" | "mismatch" | "missing";

export interface MaterialAttributes {
  itemType: string | null;
  subtype: string | null;
  sizeMm: number | null;
  sizeDisplay: string | null;
  pressureBar: number | null;
  pressureClass: string | null;
  connection: string | null;
  faceToFaceMm: number | null;
  bodyMaterial: string | null;
  discMaterial: string | null;
  stemMaterial: string | null;
  seatMaterial: string | null;
  materials: string[];
  standards: string[];
  actuation: string | null;
}

export interface MaterialImportRow {
  corporateNo: string;
  sapNo: string;
  plant: string;
  className: string;
  shortDescription: string;
  longDescription: string;
  uom: string;
  materialType: string;
  unspsc: string;
  status: string;
  statusDescription: string;
  itemTypeSource: string;
  attributes: MaterialAttributes;
  statusActive: boolean;
  rawData: Record<string, string>;
}

export interface MaterialCandidate extends MaterialImportRow {
  id: string;
  lexicalScore: number;
  fuzzyScore: number;
  embedding: number[] | null;
}

export interface AttributeComparison {
  key: string;
  label: string;
  query: string;
  candidate: string;
  state: MatchState;
  score: number;
}

export interface MaterialMatch {
  rank: number;
  id: string;
  corporateNo: string;
  sapNo: string;
  plant: string;
  className: string;
  shortDescription: string;
  longDescription: string;
  status: string;
  statusDescription: string;
  confidence: number;
  parametricScore: number;
  semanticScore: number;
  lexicalScore: number;
  comparisons: AttributeComparison[];
  mismatches: string[];
}

export interface SearchResponse {
  query: string;
  parsedQuery: MaterialAttributes;
  matches: MaterialMatch[];
  semanticMode: "gemini" | "lexical-fallback";
  warnings: string[];
  elapsedMs: number;
}

export interface BatchSearchResponse {
  results: SearchResponse[];
}

export interface UploadSummary {
  uploadId: string;
  fileName: string;
  sheetName: string;
  importedRows: number;
  activeRows: number;
  inactiveRows: number;
  uniqueMaterials: number;
  warnings: string[];
}
