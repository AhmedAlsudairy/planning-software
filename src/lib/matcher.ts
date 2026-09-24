import { areRelatedItemTypes } from "@/lib/vocabulary";
import { isBlockedStatus } from "@/lib/normalization";
import type { AttributeComparison, MaterialAttributes, MaterialCandidate, MaterialMatch, MatchState } from "@/types/material";

interface ScoredAttribute {
  key: string;
  label: string;
  query: string | null;
  candidate: string | null;
  weight: number;
  score: number;
  state: MatchState;
}

function text(value: string | null | undefined): string {
  return value?.trim().toUpperCase() || "";
}

function exactState(score: number, candidate: string | null): MatchState {
  if (!candidate) return "missing";
  if (score >= 0.99) return "exact";
  if (score >= 0.65) return "compatible";
  return "mismatch";
}

function textScore(query: string | null, candidate: string | null): number {
  if (!query || !candidate) return 0;
  const left = text(query);
  const right = text(candidate);
  return left === right || left.includes(right) || right.includes(left) ? 1 : 0;
}

function numericScore(query: number | null, candidate: number | null, tolerance: number): number {
  if (query == null || candidate == null) return 0;
  const difference = Math.abs(query - candidate);
  if (difference <= tolerance) return 1;
  return difference / Math.max(query, 1) <= 0.05 ? 0.7 : 0;
}

function pressureScore(query: MaterialAttributes, candidate: MaterialAttributes): number {
  if (query.pressureClass && candidate.pressureClass && text(query.pressureClass) === text(candidate.pressureClass)) return 1;
  if (query.pressureBar != null && candidate.pressureBar != null) {
    const difference = Math.abs(query.pressureBar - candidate.pressureBar);
    if (difference <= 0.5) return 1;
    if (difference / Math.max(query.pressureBar, 1) <= 0.1) return 0.75;
  }
  return 0;
}

function materialScore(query: MaterialAttributes, candidate: MaterialAttributes): number {
  const requested = query.materials.map(text);
  if (!requested.length) return 0;
  const offered = candidate.materials.map(text);
  if (!offered.length) return 0;
  return requested.filter((item) => offered.some((value) => value.includes(item) || item.includes(value))).length / requested.length;
}

function positionMaterialScore(query: string | null, candidate: string | null): number {
  if (!query || !candidate) return 0;
  const left = text(query);
  const right = text(candidate);
  return left === right || left.includes(right) || right.includes(left) ? 1 : 0;
}

const SUBTYPE_SYNONYMS: Record<string, string> = { "NON RETURN": "CHECK" };

function canonicalSubtype(value: string | null): string | null {
  if (!value) return null;
  const upper = text(value);
  return SUBTYPE_SYNONYMS[upper] || upper;
}

function subtypeCompatible(query: string | null, candidate: string | null): boolean {
  const left = canonicalSubtype(query);
  const right = canonicalSubtype(candidate);
  if (!left || !right) return true;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Fraction of the requested subtype modifiers the candidate also states.
 *
 * Scoring a single scalar subtype punished the right answer: a PVC-coated seamless copper tube
 * resolves to one of "COATED" or "SEAMLESS" depending only on which term is longer, so a query
 * mentioning the other one read as a mismatch, while a candidate stating no subtype at all scored
 * full credit for being silent. Overlap removes both failure modes.
 */
function subtypeScore(query: MaterialAttributes, candidate: MaterialAttributes): number {
  const requested = (query.subtypes?.length ? query.subtypes : [query.subtype]).filter(Boolean).map((value) => canonicalSubtype(value as string));
  if (!requested.length) return 0;
  const offered = (candidate.subtypes?.length ? candidate.subtypes : [candidate.subtype]).filter(Boolean).map((value) => canonicalSubtype(value as string));
  // Nothing stated either way is not evidence of disagreement, so it stays neutral rather than zero.
  if (!offered.length) return subtypeCompatible(query.subtype, candidate.subtype) ? 0.6 : 0;
  const hits = requested.filter((term) => offered.some((value) => value === term || value!.includes(term!) || term!.includes(value!)));
  return hits.length / requested.length;
}

function standardScore(query: string[], candidate: string[]): number {
  if (!query.length || !candidate.length) return 0;
  return query.filter((standard) => candidate.some((value) => text(value) === text(standard))).length / query.length;
}

function cosine(left: number[] | null, right: number[] | null): number | null {
  if (!left || !right || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return null;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

// Spares are catalogued in the same family as the item they belong to, so a query for a valve would
// otherwise be answered with that valve's repair kit. This stays a hard exclusion - unlike a family
// mismatch - because the wrong answer here is not merely lower quality, it is a different purchase.
const SPARE_PATTERN = /\bKIT\b|\bSPARE|\bREPAIR\b|\bACTUATOR\b|\bPOSITIONER\b/;

function isUnwantedSpare(query: MaterialAttributes, candidate: MaterialCandidate): boolean {
  if (query.subtype && SPARE_PATTERN.test(text(query.subtype))) return false;
  if (SPARE_PATTERN.test(text(query.itemType))) return false;
  return SPARE_PATTERN.test(`${text(candidate.className)} ${text(candidate.shortDescription)}`);
}

/**
 * How much to trust a candidate from a different item-type family.
 *
 * This used to be a hard filter that dropped every candidate whose class name did not contain the
 * query's item type. On an export whose class column is a single constant value that filter had
 * only two outcomes - reject all 12,257 rows, or reject none - so a search for a flange returned
 * nothing while a search for a pipe returned the whole catalog ranked by noise. Scoring the family
 * instead means a genuine cross-family match still surfaces, just well below the right family.
 */
function familyScore(query: MaterialAttributes, candidate: MaterialCandidate): number {
  const requested = text(query.itemType);
  const offered = text(candidate.attributes?.itemType) || text(candidate.className);
  if (!requested || !offered) return 1;
  if (requested === offered) return 1;
  if (areRelatedItemTypes(requested, offered)) return 0.85;
  return 0.15;
}

function scoreAttributes(query: MaterialAttributes, candidate: MaterialAttributes): ScoredAttribute[] {
  const pressure = pressureScore(query, candidate);
  const materials = materialScore(query, candidate);
  const standards = standardScore(query.standards, candidate.standards);
  const entries: ScoredAttribute[] = [
    { key: "itemType", label: "Item type", query: query.itemType, candidate: candidate.itemType, weight: 22, score: areRelatedItemTypes(query.itemType, candidate.itemType) ? 1 : 0, state: "missing" },
    { key: "subtype", label: "Type", query: query.subtypes?.join(", ") || query.subtype, candidate: candidate.subtypes?.join(", ") || candidate.subtype, weight: 18, score: subtypeScore(query, candidate), state: "missing" },
    { key: "size", label: "Size / DN", query: query.sizeDisplay || (query.sizeMm == null ? null : `${query.sizeMm}MM`), candidate: candidate.sizeDisplay || (candidate.sizeMm == null ? null : `${candidate.sizeMm}MM`), weight: 25, score: numericScore(query.sizeMm, candidate.sizeMm, 1), state: "missing" },
    { key: "size2", label: "Reduced size", query: query.sizeMm2 == null ? null : `${query.sizeMm2}MM`, candidate: candidate.sizeMm2 == null ? null : `${candidate.sizeMm2}MM`, weight: 12, score: numericScore(query.sizeMm2, candidate.sizeMm2, 1), state: "missing" },
    { key: "schedule", label: "Schedule", query: query.schedule, candidate: candidate.schedule, weight: 14, score: textScore(query.schedule, candidate.schedule), state: "missing" },
    { key: "connection", label: "Connection", query: query.connection, candidate: candidate.connection, weight: 20, score: textScore(query.connection, candidate.connection), state: "missing" },
    { key: "pressure", label: "Pressure", query: query.pressureClass || (query.pressureBar == null ? null : `${query.pressureBar} BAR`), candidate: candidate.pressureClass || (candidate.pressureBar == null ? null : `${candidate.pressureBar} BAR`), weight: 15, score: pressure, state: "missing" },
    { key: "angle", label: "Angle", query: query.angleDeg == null ? null : `${query.angleDeg}°`, candidate: candidate.angleDeg == null ? null : `${candidate.angleDeg}°`, weight: 12, score: numericScore(query.angleDeg, candidate.angleDeg, 0), state: "missing" },
    { key: "wallThickness", label: "Wall thickness", query: query.wallThicknessMm == null ? null : `${query.wallThicknessMm}MM`, candidate: candidate.wallThicknessMm == null ? null : `${candidate.wallThicknessMm}MM`, weight: 7, score: numericScore(query.wallThicknessMm, candidate.wallThicknessMm, 0.2), state: "missing" },
    { key: "materials", label: "Materials", query: query.materials.join(", ") || null, candidate: candidate.materials.join(", ") || null, weight: 12, score: materials, state: "missing" },
    { key: "bodyMaterial", label: "Body material", query: query.bodyMaterial, candidate: candidate.bodyMaterial, weight: 6, score: positionMaterialScore(query.bodyMaterial, candidate.bodyMaterial), state: "missing" },
    { key: "discMaterial", label: "Disc/ball material", query: query.discMaterial, candidate: candidate.discMaterial, weight: 6, score: positionMaterialScore(query.discMaterial, candidate.discMaterial), state: "missing" },
    { key: "stemMaterial", label: "Stem material", query: query.stemMaterial, candidate: candidate.stemMaterial, weight: 4, score: positionMaterialScore(query.stemMaterial, candidate.stemMaterial), state: "missing" },
    { key: "seatMaterial", label: "Seat material", query: query.seatMaterial, candidate: candidate.seatMaterial, weight: 6, score: positionMaterialScore(query.seatMaterial, candidate.seatMaterial), state: "missing" },
    { key: "faceToFace", label: "Face-to-face", query: query.faceToFaceMm == null ? null : `${query.faceToFaceMm}MM`, candidate: candidate.faceToFaceMm == null ? null : `${candidate.faceToFaceMm}MM`, weight: 8, score: numericScore(query.faceToFaceMm, candidate.faceToFaceMm, 1), state: "missing" },
    { key: "make", label: "Make", query: query.make, candidate: candidate.make, weight: 6, score: textScore(query.make, candidate.make), state: "missing" },
    { key: "standards", label: "Standards", query: query.standards.join(", ") || null, candidate: candidate.standards.join(", ") || null, weight: 7, score: standards, state: "missing" },
    { key: "actuation", label: "Actuation", query: query.actuation, candidate: candidate.actuation, weight: 10, score: textScore(query.actuation, candidate.actuation), state: "missing" },
  ];
  return entries.filter((entry) => entry.query).map((entry) => ({ ...entry, state: exactState(entry.score, entry.candidate) }));
}

interface Evaluation {
  attributes: ScoredAttribute[];
  parametric: number;
  penalty: number;
}

function evaluate(query: MaterialAttributes, candidate: MaterialCandidate): Evaluation {
  const attributes = scoreAttributes(query, candidate.attributes);
  const availableWeight = attributes.reduce((sum, attribute) => sum + attribute.weight, 0);
  const parametric = availableWeight
    ? attributes.reduce((sum, attribute) => sum + attribute.score * attribute.weight, 0) / availableWeight
    : Math.max(candidate.lexicalScore, candidate.fuzzyScore);
  const mismatched = (key: string) => attributes.find((attribute) => attribute.key === key)?.state === "mismatch";
  let penalty = familyScore(query, candidate);
  // A stated dimension that disagrees is disqualifying in a way a missing one is not: a DN100 elbow
  // is not a partial answer to a DN50 elbow, it is the wrong part.
  if (mismatched("size")) penalty *= 0.45;
  if (mismatched("size2")) penalty *= 0.7;
  if (mismatched("angle")) penalty *= 0.6;
  if (mismatched("schedule")) penalty *= 0.7;
  if (mismatched("connection")) penalty *= 0.7;
  return { attributes, parametric, penalty };
}

export function shortlistCandidates(query: MaterialAttributes, candidates: MaterialCandidate[], size: number): MaterialCandidate[] {
  return candidates
    .filter((candidate) => !isUnwantedSpare(query, candidate))
    .map((candidate) => {
      const { parametric, penalty } = evaluate(query, candidate);
      const lexical = Math.max(candidate.lexicalScore, candidate.fuzzyScore);
      const score = (parametric * 0.85 + lexical * 0.15) * penalty;
      return { candidate, score: candidate.exactMatch ? score + 1 : score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, size)
    .map((entry) => entry.candidate);
}

export function rankCandidates(query: MaterialAttributes, candidates: MaterialCandidate[], queryEmbedding: number[] | null, limit: number): MaterialMatch[] {
  const scored = candidates
    .filter((candidate) => !isUnwantedSpare(query, candidate))
    .map((candidate) => {
      const { attributes, parametric, penalty } = evaluate(query, candidate);
      const embeddingScore = cosine(queryEmbedding, candidate.embedding);
      const semantic = embeddingScore ?? Math.min(1, candidate.fuzzyScore * 0.65 + candidate.lexicalScore * 0.35);
      // Naming the material's own code or repeating its description verbatim is not a similarity
      // judgement - the user has already identified the row, so it is reported as a certainty.
      const finalScore = candidate.exactMatch ? 1 : (parametric * 0.7 + semantic * 0.3) * penalty;
      const comparisons: AttributeComparison[] = attributes.map(({ key, label, query: requested, candidate: offered, score, state }) => ({ key, label, query: requested || "—", candidate: offered || "Not specified", score: Math.round(score * 100), state }));
      return {
        rank: 0,
        id: candidate.id,
        corporateNo: candidate.corporateNo,
        sapNo: candidate.sapNo,
        plant: candidate.plant,
        plants: candidate.plants?.length ? candidate.plants : [candidate.plant].filter(Boolean),
        className: candidate.className,
        shortDescription: candidate.shortDescription,
        longDescription: candidate.longDescription,
        status: candidate.status,
        statusDescription: candidate.statusDescription,
        blocked: isBlockedStatus(candidate.status),
        exactMatch: Boolean(candidate.exactMatch),
        confidence: Math.round(finalScore * 1000) / 10,
        parametricScore: Math.round(parametric * 1000) / 10,
        semanticScore: Math.round(semantic * 1000) / 10,
        lexicalScore: Math.round(Math.max(candidate.lexicalScore, candidate.fuzzyScore) * 1000) / 10,
        comparisons,
        mismatches: comparisons.filter((item) => item.state === "mismatch" || item.state === "missing").map((item) => `${item.label}: requested ${item.query}; candidate ${item.candidate}`),
      } satisfies MaterialMatch;
    })
    // Exact identifications lead. Blocked stock stays visible but never outranks available stock of
    // comparable quality, so a buyer is not steered towards a code they cannot raise a PO against.
    .sort((left, right) => {
      if (left.exactMatch !== right.exactMatch) return left.exactMatch ? -1 : 1;
      if (left.blocked !== right.blocked) return left.blocked ? 1 : -1;
      return right.confidence - left.confidence;
    })
    .slice(0, limit);
  return scored.map((match, index) => ({ ...match, rank: index + 1 }));
}
