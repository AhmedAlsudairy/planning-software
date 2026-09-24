export type MatchState = "exact" | "compatible" | "mismatch" | "missing";

export interface MaterialAttributes {
  itemType: string | null;
  /** Most specific single subtype, for display. */
  subtype: string | null;
  /** Every subtype modifier found. A description states several ("SEAMLESS", "PVC COATED"), and
   *  which one is "the" subtype is arbitrary - so agreement is scored as set overlap. */
  subtypes: string[];
  sizeMm: number | null;
  sizeDisplay: string | null;
  /** Second bore of a reducing fitting ("REDUCER 40x20", "TEE 3\" X 2\""). */
  sizeMm2: number | null;
  schedule: string | null;
  wallThicknessMm: number | null;
  angleDeg: number | null;
  make: string | null;
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
  /** Source commodity group code and its label, kept separate from the derived search family. */
  materialGroup: string;
  materialGroupDescription: string;
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
  /** Every plant carrying this material number, collapsed into the single candidate row. */
  plants: string[];
  lexicalScore: number;
  fuzzyScore: number;
  /** True when the query names this material's code, or repeats its description verbatim. */
  exactMatch: boolean;
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
  plants: string[];
  className: string;
  shortDescription: string;
  longDescription: string;
  status: string;
  statusDescription: string;
  /** Blocked for procurement: still shown, ranked last, and badged in the UI. */
  blocked: boolean;
  exactMatch: boolean;
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
