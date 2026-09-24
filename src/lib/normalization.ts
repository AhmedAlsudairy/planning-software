import type { MaterialAttributes } from "@/types/material";
import { ACTUATIONS, CONNECTIONS, deriveItemType, expandAbbreviations, FALLBACK_SUBTYPES, ITEM_TYPE_LIST, KNOWN_MATERIALS, unescapeSapText } from "./vocabulary.ts";

export function normalizeText(value: string): string {
  return unescapeSapText(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .trim();
}

// SAP long text is assembled from fixed-width lines, and when those lines are joined the space at
// the seam is lost: "MATERIAL SPECIFICATION" arrives as "MATERIALSPECIFICATION", and a value runs
// straight into the next label as "6MMMATERIAL:". Both forms defeat label-based extraction, so the
// known labels are put back before anything is parsed. Restricting the repair to text followed by
// a colon keeps it from rewriting ordinary prose.
const LABEL_PHRASES = [
  "TUBE OUTSIDE DIAMETER", "TUBE CONNECTION TYPE", "PIPE CONNECTION TYPE", "MANUFACTURING PROCESS",
  "ADDITIONAL INFORMATION", "MATERIAL SPECIFICATION", "NOMINAL PIPE SIZE", "SURFACE TREATMENT",
  "OUTSIDE DIAMETER", "INSIDE DIAMETER", "PRESSURE RATING", "SCHEDULE RATING", "WALL THICKNESS",
  "CONNECTION TYPE", "CONNECTION SIZE", "MATERIAL GRADE", "NOMINAL SIZE", "BODY MATERIAL",
  "SEAT MATERIAL", "DISC MATERIAL", "STEM MATERIAL", "FACE TO FACE",
].sort((left, right) => right.length - left.length);

function repairLabels(value: string): string {
  let result = value;
  for (const phrase of LABEL_PHRASES) {
    const pattern = new RegExp(`([A-Z0-9])?${phrase.split(" ").join("\\s*")}(?=\\s*:)`, "g");
    result = result.replace(pattern, (_match, prefix: string | undefined) => `${prefix ? `${prefix} ` : ""}${phrase}`);
  }
  return result;
}

// The same lost-space problem detaches units from what follows them: "16MMODPIPE-AL" is
// "16MM OD PIPE-AL", and "10BARAPPLICATION" is "10BAR APPLICATION". Both hide a real value behind a
// word boundary that never matches. Only these specific continuations are separated - splitting on
// any trailing letter would turn "3INCH" into "3IN CH".
function separateGluedUnits(value: string): string {
  return value
    .replace(/(\d)\s*MM(?=[A-Z])/g, "$1MM ")
    .replace(/(\d)\s*IN(?=(?:OD|ID))/g, "$1IN ")
    .replace(/(\d)\s*(BAR|PSI)(?=[A-Z])/g, "$1$2 ");
}

function repairText(value: string): string {
  return separateGluedUnits(repairLabels(value));
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

// 4,534 of 12,257 rows in a real export carry a newline-delimited "LABEL: VALUE" block. Splitting
// on those separators first and reading each segment on its own is far more reliable than running
// lazy regexes across the whole flattened string, where a value can silently absorb the next label.
function segments(value: string): string[] {
  return unescapeSapText(value)
    .normalize("NFKC")
    .toUpperCase()
    .split(/[\n\r;]+/)
    .map((segment) => repairText(segment.replace(/\s+/g, " ")).trim())
    .filter(Boolean);
}

function extractLabeled(lines: string[], labels: string[]): string | null {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const exact = new RegExp(`(?:^|[^A-Z])(?:${escaped})\\s*:\\s*(.+)$`);
  for (const line of lines) {
    const match = line.match(exact);
    if (match?.[1]) {
      // A label may still share a line with the label that follows it; stop at that boundary.
      const value = match[1].split(/\s+[A-Z][A-Z0-9 /&_-]{2,35}\s*:/)[0];
      const cleaned = value.replace(/[, ]+$/, "").trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

// Damerau-Levenshtein (optimal string alignment): edit distance where an adjacent transposition
// (e.g. "VALEV" for "VALVE") costs 1 like a real keystroke slip, not 2 as plain Levenshtein would
// count it. Vocabulary terms and query text are short, so this is cheap - it only ever runs at
// interactive query time, never over bulk import rows, to keep large-file imports fast.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) d[i][0] = i;
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function typoTolerance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 8) return 1;
  return 2;
}

// Single-word terms only - fuzzy-matching multi-word phrases reliably needs more than a flat edit
// distance, and single words cover the vocabulary that users are actually likely to mistype.
function fuzzyContainsWord(text: string, term: string): boolean {
  const tolerance = typoTolerance(term.length);
  if (!tolerance) return false;
  return text.split(/[^A-Z0-9]+/).some((word) => Math.abs(word.length - term.length) <= tolerance && editDistance(word, term) <= tolerance);
}

function containsTerm(text: string, term: string, fuzzy = false): boolean {
  // A space inside a term may arrive as a hyphen, or as nothing at all: the catalog writes slip-on
  // as "SLIP ON", "SLP-ON" and "SLIPON" in different rows.
  const exact = new RegExp(`(?:^|[^A-Z0-9])${term.replace(/\s+/g, "[\\s-]*").replace(/\//g, "\\/")}(?:$|[^A-Z0-9])`).test(text);
  if (exact || !fuzzy || term.includes(" ")) return exact;
  return fuzzyContainsWord(text, term);
}

// Every term in the list that the text states, most specific first. Capped because the score is an
// overlap ratio: a description listing twenty modifiers should not dilute the ones that matter.
const MAX_MATCHED_TERMS = 8;

function findTerms(text: string, terms: string[], fuzzy = false): string[] {
  const exact = terms.filter((term) => containsTerm(text, term));
  if (exact.length || !fuzzy) return exact.slice(0, MAX_MATCHED_TERMS);
  return terms.filter((term) => containsTerm(text, term, true)).slice(0, MAX_MATCHED_TERMS);
}

// Two passes, not one: an exact hit anywhere in the list beats a fuzzy hit earlier in it.
// Searching "1/4 inch BSP" used to be reported as connection "BSPP", because BSPP precedes BSP in
// the list and is within one edit of it.
function findTerm(text: string, terms: string[], fuzzy = false): string | null {
  const exact = terms.find((term) => containsTerm(text, term));
  if (exact || !fuzzy) return exact || null;
  return terms.find((term) => containsTerm(text, term, true)) || null;
}

function canonicalMaterial(value: string | null, fuzzy = false): string | null {
  if (!value) return null;
  const normalized = normalizeText(value).replace(/^MOC\s*/, "");
  const known = findTerm(`${normalized} ${expandAbbreviations(normalized)}`, KNOWN_MATERIALS, fuzzy);
  return known || normalized.slice(0, 80);
}

const MM_PER_INCH = 25.4;

/**
 * Converts one size expression to millimetres. Fractional inches are the reason this exists: the
 * previous single regex read "1/4IN" as "4 IN" because "/" is a word boundary, so a quarter-inch
 * tube was indexed as 101.6 mm instead of 6.35 mm - 25x too large, and indistinguishable from a
 * genuine 4-inch item. 3,125 of 12,257 rows in a real export contain fractional inch sizes.
 */
function toMillimetres(amount: string, unit: string | undefined, fallbackUnit: string | null): { mm: number; unit: string } | null {
  const mixed = amount.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/);
  const fraction = amount.match(/^(\d+)\s*\/\s*(\d+)$/);
  let value: number;
  if (mixed) value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (fraction) value = Number(fraction[1]) / Number(fraction[2]);
  else value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const resolved = (unit || fallbackUnit || "MM").toUpperCase();
  const inches = /^(IN|INCH|INCHES|")$/.test(resolved);
  return { mm: inches ? Number((value * MM_PER_INCH).toFixed(2)) : Number(value.toFixed(2)), unit: inches ? "IN" : "MM" };
}

// A single size expression: an optional DN/NB prefix, a decimal, fraction or mixed-fraction amount,
// and an optional unit. Kept as a source string so it can be reused inside the "A x B" pattern.
const AMOUNT = String.raw`\d+(?:\s*-\s*\d+\s*\/\s*\d+|\s*\/\s*\d+|\.\d+)?`;
const UNIT = String.raw`MM|INCHES|INCH|IN|"`;
const SIZE = String.raw`(?:DN|NB|NPS)?\s*(${AMOUNT})\s*(${UNIT})?`;
// Deliberately not a word boundary: the catalog glues a size onto the word before it
// ("HEAVYDUTY16MM"), and that is still a size. Only a preceding digit or decimal point would mean
// the capture is splitting a larger number in half.
const UNGLUED = String.raw`(?<![\d.])`;

function displaySize(amount: string, unit: string): string {
  return `${amount.replace(/\s+/g, "")}${unit}`;
}

function parseSize(text: string): Pick<MaterialAttributes, "sizeMm" | "sizeDisplay" | "sizeMm2"> {
  const empty = { sizeMm: null, sizeDisplay: null, sizeMm2: null };
  // Reducing fittings state both bores ("40x20", "3\" X 2\"", "25MMX20MM"). Read them together so
  // the larger bore becomes the primary size instead of whichever number the scan happened to hit.
  const pair = text.match(new RegExp(`${SIZE}\\s*[X×]\\s*${SIZE}`, "i"));
  if (pair) {
    const first = toMillimetres(pair[1], pair[2], pair[4] || null);
    const second = toMillimetres(pair[3], pair[4], pair[2] || null);
    if (first && second) {
      return { sizeMm: first.mm, sizeDisplay: displaySize(pair[1], first.unit), sizeMm2: second.mm };
    }
  }
  // A labelled size is authoritative; an unlabelled number may be a wall thickness or a length.
  const labelled = text.match(new RegExp(String.raw`(?:NOMINAL PIPE SIZE|NOMINAL SIZE|CONNECTION SIZE|OUTSIDE DIAMETER|\bSIZE|\bOD|\bDIA(?:METER)?)\s*:?\s*${SIZE}`, "i"));
  const dn = text.match(new RegExp(String.raw`\b(?:DN|NB|NPS)\s*[-:]?\s*(${AMOUNT})\s*(${UNIT})?`, "i"));
  const trailingNb = text.match(new RegExp(String.raw`${UNGLUED}(${AMOUNT})\s*NB\b`, "i"));
  const inches = text.match(new RegExp(String.raw`${UNGLUED}(${AMOUNT})\s*(INCHES|INCH|IN|")(?:\b|$)`, "i"));
  const millimetres = text.match(new RegExp(String.raw`${UNGLUED}(${AMOUNT})\s*(MM)\b`, "i"));
  for (const [match, fallback] of [[labelled, null], [dn, "MM"], [trailingNb, "MM"], [inches, "IN"], [millimetres, "MM"]] as const) {
    if (!match) continue;
    const size = toMillimetres(match[1], match[2], fallback);
    if (size) return { sizeMm: size.mm, sizeDisplay: displaySize(match[1], size.unit), sizeMm2: null };
  }
  return empty;
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

// Schedule is the wall-thickness class of a pipe or fitting and is quoted constantly in this
// catalog (2,597 rows). Two items that agree on bore but not on schedule are not interchangeable.
function parseSchedule(text: string): string | null {
  const match = text.match(/\bSCH(?:EDULE)?(?:\s*RATING)?\s*[-:]?\s*(XXS|XS|STD|\d{1,3}\s*S?)\b/i);
  if (!match) return null;
  return `SCH ${match[1].replace(/\s+/g, "").toUpperCase()}`;
}

function parseAngle(text: string): number | null {
  // Same glued-digit problem as sizes: "ELBOW BW DN200SCH80CS45DEG" states a 45 degree bend.
  const match = text.match(new RegExp(String.raw`${UNGLUED}(\d{1,3}(?:\.\d+)?)\s*(?:DEG(?:REE)?S?|°)`, "i"));
  if (!match) return null;
  const angle = Number(match[1]);
  return angle > 0 && angle <= 360 ? angle : null;
}

function parseWallThickness(lines: string[], text: string): number | null {
  const labelled = extractLabeled(lines, ["WALL THICKNESS", "THICKNESS", "THK"]);
  const source = labelled || text.match(/\b(?:WALL\s*THICKNESS|THK)\s*[-:]?\s*(\d+(?:\.\d+)?\s*(?:MM|IN)?)/i)?.[1] || null;
  if (!source) return null;
  const match = source.match(new RegExp(`^${SIZE}`, "i"));
  if (!match) return null;
  return toMillimetres(match[1], match[2], "MM")?.mm ?? null;
}

// The exact scan is positional and tier-aware, which is what makes "ELBW PIPE" an ELBOW rather
// than a PIPE. Typo tolerance cannot preserve that ordering, so it is only a fallback for when the
// exact scan finds nothing at all - and ITEM_TYPE_LIST is already ordered specific-first.
function resolveItemType(value: string, className: string, termText: string, fuzzy: boolean): string | null {
  const exact = deriveItemType(value, "", className);
  if (exact || !fuzzy) return exact;
  return ITEM_TYPE_LIST.find((type) => containsTerm(termText, type, true)) || null;
}

/**
 * @param fuzzy Tolerate small typos/misspellings (e.g. "BUTTRFLY", "FLANGD") when recognizing
 * vocabulary keywords. Only worth the extra cost at interactive query time - bulk import rows are
 * parsed with this off so large-file imports stay fast.
 */
export function parseAttributes(value: string, className = "", subtypeTerms: string[] = FALLBACK_SUBTYPES, fuzzy = false): MaterialAttributes {
  const lines = segments(`${className}\n${value}`);
  const text = repairText(normalizeText(`${className} ${value}`));
  // Terms are looked for in the original wording *and* its expansion, so "CS" is recognized as
  // carbon steel while "SS 316L" keeps its grade, and a query typed either way still matches.
  const termText = `${text} ${expandAbbreviations(text)}`;
  const orderedSubtypeTerms = [...subtypeTerms].sort((left, right) => right.length - left.length);
  const subtypes = findTerms(termText, orderedSubtypeTerms, fuzzy);
  const size = parseSize(text);
  const pressure = parsePressure(text);
  const standards = [...new Set(Array.from(text.matchAll(/\b(?:EN\s*\d+(?:[-.]\d+)*|API\s*\d+(?:[-.]\d+)*|DIN\s*\d+(?:[-.]\d+)*|ISO\s*\d+(?:[-.]\d+)*|ASTM\s*-?\s*[A-Z]?-?\s*\d+(?:[-.]\d+)*|IS\s*\d{3,}|(?:ANSI|ASME)\s*[A-Z]*\s*\d+(?:\.\d+)*)\b/g), (match) => match[0].replace(/\s+/g, " ")))];
  const materials = [...new Set(KNOWN_MATERIALS.filter((material) => containsTerm(termText, material, fuzzy)))];
  const faceMatch = text.match(/(?:FACE[ -]?TO[ -]?FACE|\bFF)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*MM\b/i);
  const bodyMaterial = canonicalMaterial(extractLabeled(lines, ["BODY MATERIAL", "BODY MOC", "BODY"]), fuzzy);
  const discMaterial = canonicalMaterial(extractLabeled(lines, ["DISC MATERIAL", "DISC MOC", "DISC"]), fuzzy);
  const stemMaterial = canonicalMaterial(extractLabeled(lines, ["STEM MATERIAL", "STEM MOC", "STEM"]), fuzzy);
  const seatMaterial = canonicalMaterial(extractLabeled(lines, ["SEAT MATERIAL", "SEAT MOC", "SEAT", "LINER MATERIAL", "SEAL MATERIAL"]), fuzzy);
  return {
    itemType: resolveItemType(value, className, termText, fuzzy),
    subtype: subtypes[0] ?? null,
    subtypes,
    ...size,
    schedule: parseSchedule(text),
    wallThicknessMm: parseWallThickness(lines, text),
    angleDeg: parseAngle(text),
    make: extractLabeled(lines, ["MAKE", "BRAND", "MANUFACTURER"])?.slice(0, 60) || null,
    ...pressure,
    connection: findTerm(termText, CONNECTIONS, fuzzy),
    faceToFaceMm: faceMatch ? Number(faceMatch[1]) : null,
    bodyMaterial,
    discMaterial,
    stemMaterial,
    seatMaterial,
    materials: [...new Set([bodyMaterial, discMaterial, stemMaterial, seatMaterial, ...materials].filter((item): item is string => Boolean(item)))],
    standards,
    actuation: findTerm(termText, ACTUATIONS, fuzzy),
  };
}

// "Blocked for Procurement" items still exist and are still legitimate answers to "what is the code
// for this part?", so they stay searchable and are ranked last rather than hidden. Only codes that
// were never issued or were withdrawn are excluded outright.
const BLOCKED_STATUS_PATTERN = /BLOCKED/;

export function isBlockedStatus(status: string): boolean {
  return BLOCKED_STATUS_PATTERN.test(normalizeText(status));
}

export function isActiveStatus(status: string): boolean {
  const normalized = normalizeText(status);
  return !normalized.includes("DELETED") && !normalized.includes("RFD STAGED") && !normalized.includes("RFUD STAGED");
}

export { areRelatedItemTypes, deriveItemType, deriveSubtypeVocabulary, buildSearchText } from "./vocabulary.ts";

export function materialSearchText(className: string, shortDescription: string, longDescription: string): string {
  return normalizeText(`${className} ${shortDescription} ${longDescription}`);
}
