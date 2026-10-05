/**
 * Part-number ("model") matching: bearings, motors and other catalogue items identified by a
 * designation like "NU 2232 ECMA/C3" rather than by size and material. Catalogues spell the same
 * designation with spaces, slashes or dashes, so everything is compared with separators removed.
 */

export interface ModelQuery {
  /** The whole designation, separators removed ("NU2232ECMAC3"). */
  primary: string;
  /** Contiguous pieces of the designation, so a row carrying only part of it is still retrieved. */
  spans: string[];
}

export interface ModelMatch {
  kind: "exact" | "close" | "none";
  /** 1 for exact; below 0.85 for close, so a near-miss never reads as an identification. */
  score: number;
  /** The designation as the row spells it (compacted); set when kind is "close". */
  found: string | null;
}

const MIN_DESIGNATION_LENGTH = 6;
const MAX_SPANS = 12;
const MIN_SPAN_LENGTH = 5;
const MAX_LETTER_TOKEN = 4;
const MIN_NUMBER_TOKEN = 3;

// Words that sit next to part numbers in a typed description but are not part of one.
const DESCRIPTIVE_WORDS = new Set([
  "FOR", "WITH", "AND", "THE", "OF", "TO", "IN", "ON", "BALL", "BOLT", "NUT", "PIPE", "TUBE", "TEE", "CAP", "PIN",
  "SEAL", "RING", "BAR", "ROD", "GEAR", "BELT", "FAN", "PUMP", "HOSE", "PLUG", "DISC", "FLAT", "TYPE", "SIZE", "MOTOR",
]);

// Sizes, ratings and thread codes that mix letters and digits but describe a dimension, not a part.
const DIMENSION_TOKEN = /^(?:(?:DN|PN|NPS|NB|SCH|CL|CLASS|ANSI|M|G|BSP|NPT)\d+|\d+(?:MM|CM|M|IN|INCH|BAR|PSI|KG|DEG|KW|HP|V|A|HZ|RPM|X\d+)#?)$/;

export function compact(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Optimal-string-alignment distance: an adjacent transposition ("2322" for "2232") costs one. */
export function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      table[row][col] = Math.min(table[row - 1][col] + 1, table[row][col - 1] + 1, table[row - 1][col - 1] + cost);
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        table[row][col] = Math.min(table[row][col], table[row - 2][col - 2] + 1);
      }
    }
  }
  return table[left.length][right.length];
}

const hasDigit = (text: string) => /\d/.test(text);

export function extractModelQuery(query: string): ModelQuery | null {
  const allLowercase = query === query.toLowerCase();
  const tokens = query.split(/[\s/\-,;:()]+/).map((token) => token.replace(/[^A-Za-z0-9#]/g, "")).filter(Boolean);
  const eligible = tokens.map((token) => {
    const upper = token.toUpperCase();
    if (DIMENSION_TOKEN.test(upper)) return false;
    const letters = /^[A-Za-z]+$/.test(token);
    if (!letters) return /[A-Za-z]/.test(token) || (/^\d+$/.test(token) && token.length >= MIN_NUMBER_TOKEN);
    if (DESCRIPTIVE_WORDS.has(upper) || token.length > MAX_LETTER_TOKEN) return false;
    // A short word in capitals is a designation fragment; a lowercase one is a description word -
    // unless the whole query is lowercase, where capitalisation says nothing.
    return token === upper || allLowercase;
  });

  let best: string[] = [];
  let run: string[] = [];
  const close = () => {
    const joined = compact(run.join(""));
    if (/[A-Z]/.test(joined) && hasDigit(joined) && joined.length >= MIN_DESIGNATION_LENGTH && joined.length > compact(best.join("")).length) best = run;
    run = [];
  };
  tokens.forEach((token, index) => (eligible[index] ? run.push(token) : close()));
  close();
  if (!best.length) return null;

  const pieces = best.map(compact);
  const primary = pieces.join("");
  const spans = new Set<string>();
  for (let start = 0; start < pieces.length; start += 1) {
    for (let end = start + 1; end <= pieces.length; end += 1) {
      const span = pieces.slice(start, end).join("");
      if (span.length >= MIN_SPAN_LENGTH && hasDigit(span)) spans.add(span);
    }
  }
  const ordered = [...spans].sort((left, right) => right.length - left.length).slice(0, MAX_SPANS);
  return { primary, spans: ordered };
}

/** `rowCompact` is the row's description with separators removed (see `compact`). */
export function matchModel(model: ModelQuery, rowCompact: string): ModelMatch {
  if (rowCompact.includes(model.primary)) return { kind: "exact", score: 1, found: null };
  const length = model.primary.length;
  const allowance = Math.max(1, Math.floor(length * 0.15));
  let bestDistance = Infinity;
  let bestWindow = "";
  for (let size = length - 1; size <= length + 1; size += 1) {
    for (let start = 0; start + size <= rowCompact.length; start += 1) {
      const window = rowCompact.slice(start, start + size);
      // Windows must start and end like the query so a distance over run-on description text is not found by chance.
      if (window[0] !== model.primary[0] && window[1] !== model.primary[1]) continue;
      const distance = editDistance(model.primary, window);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestWindow = window;
      }
    }
  }
  if (bestDistance === 0 || bestDistance > allowance) return { kind: "none", score: 0, found: null };
  return { kind: "close", score: Math.max(0.5, 0.85 - 0.12 * bestDistance), found: bestWindow };
}
