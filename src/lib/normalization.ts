import type { MaterialAttributes } from "@/types/material";

const CONNECTIONS = ["DOUBLE FLANGED", "FLANGED", "FLANGE", "WAFER", "LUG", "THREADED", "SCREWED", "SOCKET WELD", "BUTT WELD", "BSP", "NPT", "RTJ", "RF"];
// Used only when no data-derived vocabulary is available (e.g. tests, or before the first import).
// db.ts:getSubtypeVocabulary() supersedes this at runtime by learning subtype terms from class_name.
const FALLBACK_SUBTYPES = ["BUTTERFLY", "SOLENOID", "CHECK", "CONTROL", "RELIEF", "BALL", "GATE", "GLOBE", "NEEDLE", "PLUG", "DIAPHRAGM", "KNIFE GATE", "NON RETURN"];
const ACTUATIONS = ["ELECTRIC", "PNEUMATIC", "HYDRAULIC", "MANUAL", "LEVER", "GEAR OPERATED", "GEARBOX", "AUTOMATIC", "PILOT OPERATED"];
const KNOWN_MATERIALS = ["CF8M", "CF8", "SS 316L", "SS316L", "SS 316", "SS316", "SS 304", "SS304", "SS", "STAINLESS STEEL", "DUCTILE IRON", "NODULAR CI", "CAST IRON", "CI", "DI", "EPDM", "NBR", "PTFE", "PFA", "VITON", "FKM", "BRONZE", "BRASS", "WCB", "WC6", "CS", "PVC", "CPVC"];

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .trim();
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function extractLabeled(text: string, labels: string[]): string | null {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`(?:${escaped})\\s*:\\s*([^;]+?)(?=\\s+[A-Z][A-Z0-9 /&_-]{2,35}\\s*:|$)`, "i"));
  return match?.[1]?.replace(/[, ]+$/, "").trim() || null;
}

function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(?:^|[^A-Z0-9])${term.replace(/\s+/g, "\\s*").replace(/\//g, "\\/")}(?:$|[^A-Z0-9])`).test(text);
}

function findTerm(text: string, terms: string[]): string | null {
  return terms.find((term) => containsTerm(text, term)) || null;
}

function canonicalMaterial(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeText(value).replace(/^MOC\s*/, "");
  const known = findTerm(normalized, KNOWN_MATERIALS);
  return known || normalized.slice(0, 80);
}

function parseSize(text: string): Pick<MaterialAttributes, "sizeMm" | "sizeDisplay"> {
  const dn = text.match(/\bDN\s*[-:]?\s*(\d+(?:\.\d+)?)\b/i);
  if (dn) return { sizeMm: Number(dn[1]), sizeDisplay: `DN${displayNumber(Number(dn[1]))}` };
  const nb = text.match(/\b(\d+(?:\.\d+)?)\s*NB\b/i) || text.match(/\bNB\s*[-:]?\s*(\d+(?:\.\d+)?)\b/i);
  if (nb) return { sizeMm: Number(nb[1]), sizeDisplay: `DN${displayNumber(Number(nb[1]))}` };
  const labeled = text.match(/(?:\bSIZE|CONNECTION SIZE|NOMINAL SIZE)\s*:\s*(\d+(?:\.\d+)?)\s*(MM|INCHES|INCH|IN|\")(?:\b|$)/i);
  const compact = text.match(/\b(\d+(?:\.\d+)?)\s*(MM|INCHES|INCH|IN)\b/i);
  const match = labeled || compact;
  if (!match) return { sizeMm: null, sizeDisplay: null };
  const amount = Number(match[1]);
  const inches = /IN|"/i.test(match[2]);
  return {
    sizeMm: inches ? Number((amount * 25.4).toFixed(2)) : amount,
    sizeDisplay: `${displayNumber(amount)}${inches ? "IN" : "MM"}`,
  };
}

const MAX_PLAUSIBLE_PRESSURE_RATING = 2500;

function parsePressure(text: string): Pick<MaterialAttributes, "pressureBar" | "pressureClass"> {
  // "PN:" also prefixes OEM part numbers in this data (e.g. "PN:54813982"); a real nominal-pressure
  // rating never runs that high, so an implausibly large capture is treated as no match at all.
  const pn = text.match(/\bPN\s*[-:]?\s*(\d+(?:\.\d+)?)\b/i);
  if (pn && Number(pn[1]) <= MAX_PLAUSIBLE_PRESSURE_RATING) return { pressureBar: Number(pn[1]), pressureClass: `PN${displayNumber(Number(pn[1]))}` };
  const asme = text.match(/\b(?:CLASS|CL)\s*[-:]?\s*(\d+)\b|\b(\d+)\s*(?:LB|LBS|#)\b/i);
  if (asme) {
    const rating = Number(asme[1] || asme[2]);
    if (rating <= MAX_PLAUSIBLE_PRESSURE_RATING) return { pressureBar: null, pressureClass: `CLASS ${rating}` };
  }
  const bar = text.match(/(?:PRESSURE RATING\s*:\s*(?:MAX\s*)?)?(\d+(?:\.\d+)?)\s*BAR\b/i);
  if (bar) return { pressureBar: Number(bar[1]), pressureClass: `${displayNumber(Number(bar[1]))} BAR` };
  const psi = text.match(/\b(\d+(?:\.\d+)?)\s*PSI\b/i);
  if (psi) return { pressureBar: Number((Number(psi[1]) * 0.0689476).toFixed(2)), pressureClass: `${displayNumber(Number(psi[1]))} PSI` };
  return { pressureBar: null, pressureClass: null };
}

function inferItemType(text: string, className?: string): string | null {
  const source = normalizeText(className || "");
  if (source.includes("VALVE")) return "VALVE";
  const first = source.split(",")[0]?.trim();
  if (first && first !== "MATERIAL" && first !== "GENERIC") return first;
  const known = ["VALVE", "SEAT", "GEARBOX", "DAMPER", "CABLE", "BEARING", "MOTOR", "PUMP", "BOLT", "GASKET", "FLANGE", "PIPE", "FITTING", "ACTUATOR"];
  return known.find((type) => new RegExp(`\\b${type}\\b`).test(text)) || null;
}

export function parseAttributes(value: string, className = "", subtypeTerms: string[] = FALLBACK_SUBTYPES): MaterialAttributes {
  const text = normalizeText(`${className} ${value}`);
  const orderedSubtypeTerms = [...subtypeTerms].sort((left, right) => right.length - left.length);
  const size = parseSize(text);
  const pressure = parsePressure(text);
  const standards = [...new Set(Array.from(text.matchAll(/\b(?:EN\s*\d+(?:[-.]\d+)*|API\s*\d+(?:[-.]\d+)*|DIN\s*\d+(?:[-.]\d+)*|(?:ANSI|ASME)\s*[A-Z]*\s*\d+(?:\.\d+)*)\b/g), (match) => match[0].replace(/\s+/g, " ")))];
  const materials = [...new Set(KNOWN_MATERIALS.filter((material) => containsTerm(text, material)))];
  const faceMatch = text.match(/(?:FACE[ -]?TO[ -]?FACE|\bFF)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*MM\b/i);
  const bodyMaterial = canonicalMaterial(extractLabeled(text, ["BODY MATERIAL", "BODY MOC", "BODY"]));
  const discMaterial = canonicalMaterial(extractLabeled(text, ["DISC MATERIAL", "DISC MOC", "DISC"]));
  const stemMaterial = canonicalMaterial(extractLabeled(text, ["STEM MATERIAL", "STEM MOC", "STEM"]));
  const seatMaterial = canonicalMaterial(extractLabeled(text, ["SEAT MATERIAL", "SEAT MOC", "SEAT", "LINER MATERIAL", "SEAL MATERIAL"]));
  return {
    itemType: inferItemType(text, className),
    subtype: findTerm(text, orderedSubtypeTerms) || (containsTerm(text, "BTRFLY") ? "BUTTERFLY" : null),
    ...size,
    ...pressure,
    connection: findTerm(text, CONNECTIONS),
    faceToFaceMm: faceMatch ? Number(faceMatch[1]) : null,
    bodyMaterial,
    discMaterial,
    stemMaterial,
    seatMaterial,
    materials: [...new Set([bodyMaterial, discMaterial, stemMaterial, seatMaterial, ...materials].filter((item): item is string => Boolean(item)))],
    standards,
    actuation: findTerm(text, ACTUATIONS),
  };
}

export function isActiveStatus(status: string): boolean {
  const normalized = normalizeText(status);
  return !normalized.includes("DELETED") && !normalized.includes("RFD STAGED") && !normalized.includes("RFUD STAGED");
}

export function materialSearchText(className: string, shortDescription: string, longDescription: string): string {
  return normalizeText(`${className} ${shortDescription} ${longDescription}`);
}

// class_name follows a "TYPE, SUBTYPE[, MODIFIER]" comma convention (e.g. "VALVE, BUTTERFLY",
// "BALL, VALVE", "VALVE, REGULATING, FLUID PRESSURE"). Splitting on commas and discarding the
// generic/structural segments yields the subtype vocabulary directly from whatever data is at
// hand, instead of a hand-maintained word list that goes stale as new item types appear.
const SUBTYPE_VOCABULARY_STOPWORDS = new Set([
  "VALVE", "VALVES", "MATERIAL", "MATERIALS", "GENERIC", "ASSEMBLY", "ASSEMBLIES", "KIT", "KITS",
  "REPAIR", "SPARE", "SPARES", "BODY", "SEAT", "ACTUATOR", "POSITIONER", "SKIRT",
  "AND", "FOR", "TYPE", "N A", "MISC", "MISCELLANEOUS", "OTHER", "OTHERS",
]);

export function deriveSubtypeVocabulary(classNames: string[]): string[] {
  const terms = new Set(FALLBACK_SUBTYPES);
  for (const className of classNames) {
    for (const part of (className || "").toUpperCase().split(",")) {
      const term = part.trim();
      if (term.length >= 3 && term.length <= 24 && /^[A-Z][A-Z /-]*[A-Z]$/.test(term) && !SUBTYPE_VOCABULARY_STOPWORDS.has(term)) terms.add(term);
    }
  }
  return [...terms];
}
