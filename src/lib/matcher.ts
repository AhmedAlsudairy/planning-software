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

function isWrongFamily(query: MaterialAttributes, candidate: MaterialCandidate): boolean {
  if (!query.itemType) return false;
  const className = text(candidate.className);
  if (!className.includes(text(query.itemType))) return true;
  if (query.itemType === "VALVE" && !query.subtype && /KIT|SEAT|ACTUATOR|POSITIONER|SPARE/.test(className)) return true;
  return false;
}

function scoreAttributes(query: MaterialAttributes, candidate: MaterialAttributes): ScoredAttribute[] {
  const pressure = pressureScore(query, candidate);
  const materials = materialScore(query, candidate);
  const standards = standardScore(query.standards, candidate.standards);
  const entries: ScoredAttribute[] = [
    { key: "size", label: "Size / DN", query: query.sizeDisplay || (query.sizeMm == null ? null : `${query.sizeMm}MM`), candidate: candidate.sizeDisplay || (candidate.sizeMm == null ? null : `${candidate.sizeMm}MM`), weight: 25, score: numericScore(query.sizeMm, candidate.sizeMm, 1), state: "missing" },
    { key: "connection", label: "Connection", query: query.connection, candidate: candidate.connection, weight: 20, score: textScore(query.connection, candidate.connection), state: "missing" },
    { key: "pressure", label: "Pressure", query: query.pressureClass || (query.pressureBar == null ? null : `${query.pressureBar} BAR`), candidate: candidate.pressureClass || (candidate.pressureBar == null ? null : `${candidate.pressureBar} BAR`), weight: 15, score: pressure, state: "missing" },
    { key: "materials", label: "Materials", query: query.materials.join(", ") || null, candidate: candidate.materials.join(", ") || null, weight: 15, score: materials, state: "missing" },
    { key: "faceToFace", label: "Face-to-face", query: query.faceToFaceMm == null ? null : `${query.faceToFaceMm}MM`, candidate: candidate.faceToFaceMm == null ? null : `${candidate.faceToFaceMm}MM`, weight: 8, score: numericScore(query.faceToFaceMm, candidate.faceToFaceMm, 1), state: "missing" },
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
  let penalty = 1;
  if (attributes.find((attribute) => attribute.key === "size")?.state === "mismatch") penalty *= 0.45;
  if (attributes.find((attribute) => attribute.key === "connection")?.state === "mismatch") penalty *= 0.7;
  return { attributes, parametric, penalty };
}

export function shortlistCandidates(query: MaterialAttributes, candidates: MaterialCandidate[], size: number): MaterialCandidate[] {
  return candidates
    .filter((candidate) => !isWrongFamily(query, candidate))
    .map((candidate) => {
      const { parametric, penalty } = evaluate(query, candidate);
      const lexical = Math.max(candidate.lexicalScore, candidate.fuzzyScore);
      return { candidate, score: (parametric * 0.85 + lexical * 0.15) * penalty };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, size)
    .map((entry) => entry.candidate);
}

export function rankCandidates(query: MaterialAttributes, candidates: MaterialCandidate[], queryEmbedding: number[] | null, limit: number): MaterialMatch[] {
  const scored = candidates
    .filter((candidate) => !isWrongFamily(query, candidate))
    .map((candidate) => {
      const { attributes, parametric, penalty } = evaluate(query, candidate);
      const embeddingScore = cosine(queryEmbedding, candidate.embedding);
      const semantic = embeddingScore ?? Math.min(1, candidate.fuzzyScore * 0.65 + candidate.lexicalScore * 0.35);
      const finalScore = (parametric * 0.7 + semantic * 0.3) * penalty;
      const comparisons: AttributeComparison[] = attributes.map(({ key, label, query: requested, candidate: offered, score, state }) => ({ key, label, query: requested || "—", candidate: offered || "Not specified", score: Math.round(score * 100), state }));
      return {
        rank: 0,
        id: candidate.id,
        corporateNo: candidate.corporateNo,
        sapNo: candidate.sapNo,
        plant: candidate.plant,
        className: candidate.className,
        shortDescription: candidate.shortDescription,
        longDescription: candidate.longDescription,
        status: candidate.status,
        statusDescription: candidate.statusDescription,
        confidence: Math.round(finalScore * 1000) / 10,
        parametricScore: Math.round(parametric * 1000) / 10,
        semanticScore: Math.round(semantic * 1000) / 10,
        lexicalScore: Math.round(Math.max(candidate.lexicalScore, candidate.fuzzyScore) * 1000) / 10,
        comparisons,
        mismatches: comparisons.filter((item) => item.state === "mismatch" || item.state === "missing").map((item) => `${item.label}: requested ${item.query}; candidate ${item.candidate}`),
      } satisfies MaterialMatch;
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
  return scored.map((match, index) => ({ ...match, rank: index + 1 }));
}
