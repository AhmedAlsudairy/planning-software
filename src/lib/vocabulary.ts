// SAP short texts are written in a 40-character abbreviated dialect ("FLNG PIPE;SLP-ON,RSD FACE"),
// while people search in plain English ("slip on pipe flange, raised face"). Neither lexical nor
// trigram scoring bridges that gap on its own, and the same concept appears in the catalog both
// ways (ELBW 744 rows vs ELBOW 1017), so no single spelling finds everything.
//
// Every entry below was taken from the token frequencies of a real 12,257-row export rather than
// guessed, so the dictionary reflects the abbreviations that actually occur in the data.
const ABBREVIATIONS: Record<string, string> = {
  // Component nouns
  ELBW: "ELBOW", ELB: "ELBOW", FLNG: "FLANGE", FLG: "FLANGE", REDCR: "REDUCER", RDCR: "REDUCER",
  NPLE: "NIPPLE", NPPL: "NIPPLE", NIPL: "NIPPLE", CLMP: "CLAMP", SCKT: "SOCKET", SKT: "SOCKET",
  CPLG: "COUPLING", CPLR: "COUPLER", ADPTR: "ADAPTOR", ADPTER: "ADAPTOR", ADAPTER: "ADAPTOR",
  FTNG: "FITTING", FTG: "FITTING", GSKT: "GASKET", FRRL: "FERRULE", NOZL: "NOZZLE", NZL: "NOZZLE",
  STRNR: "STRAINER", VLV: "VALVE", TBE: "TUBE", RNG: "RING", JNT: "JOINT", BLW: "BELLOW",
  CONECTOR: "CONNECTOR", CONNECTO: "CONNECTOR", CONNECT: "CONNECTOR", STUBEND: "STUB END",
  WELDOLET: "WELDOLET", SDLE: "SADDLE", PLG: "PLUG", BSH: "BUSH", CPL: "COUPLING",

  // Shapes and modifiers
  BTRFLY: "BUTTERFLY", CNCNTRC: "CONCENTRIC", CONC: "CONCENTRIC", ECCNTRC: "ECCENTRIC",
  ECC: "ECCENTRIC", EQL: "EQUAL", UNEQL: "UNEQUAL", RDCNG: "REDUCING", STRGHT: "STRAIGHT",
  STRT: "STRAIGHT", HEX: "HEXAGON", HEXA: "HEXAGON", SLP: "SLIP", RSD: "RAISED", BLND: "BLIND",
  SPRL: "SPIRAL", WND: "WOUND", BVL: "BEVEL", INSULTNG: "INSULATING", INSLTD: "INSULATED",
  HVY: "HEAVY", LNG: "LONG", LG: "LONG", SHRT: "SHORT", FEM: "FEMALE", ML: "MALE",
  HD: "HEAVY DUTY", LR: "LONG RADIUS", SR: "SHORT RADIUS", MITER: "MITRE",

  // Connections and end preparations
  BW: "BUTT WELD", SW: "SOCKET WELD", WLD: "WELD", WLDD: "WELDED", THRD: "THREADED",
  THRDD: "THREADED", THD: "THREADED", SORF: "SLIP ON RAISED FACE", WNRF: "WELD NECK RAISED FACE",
  SOFF: "SLIP ON FLAT FACE", WN: "WELD NECK", FBSP: "FEMALE BSP", MBSP: "MALE BSP",
  FNPT: "FEMALE NPT", MNPT: "MALE NPT", FBSPP: "FEMALE BSPP", MBSPP: "MALE BSPP",

  // Materials
  CS: "CARBON STEEL", SS: "STAINLESS STEEL", MS: "MILD STEEL", STL: "STEEL", GI: "GALVANISED IRON",
  CU: "COPPER", AL: "ALUMINIUM", PP: "POLYPROPYLENE", PE: "POLYETHYLENE", BRS: "BRASS",
  MTLC: "METALLIC", NONMTLC: "NONMETALLIC", DI: "DUCTILE IRON", CI: "CAST IRON",

  // Manufacturing and specification shorthand
  SMLS: "SEAMLESS", SML: "SEAMLESS", SEMLS: "SEAMLESS", SEAMLE: "SEAMLESS", STD: "STANDARD",
  DEG: "DEGREE", DIA: "DIAMETER", THK: "THICKNESS", DRG: "DRAWING", PERDRG: "PER DRAWING",
  HYD: "HYDRAULIC", PNMTC: "PNEUMATIC", OD: "OUTSIDE DIAMETER", ID: "INSIDE DIAMETER",
};

// Item types are the retrieval families: a query for an elbow should never be answered with a
// flange. Tier 0 are specific components; tier 1 are generic forms that appear as a trailing
// qualifier in most short texts ("ELBW PIPE", "CLAMP PIPE") and must therefore lose to any
// specific type found alongside them.
const ITEM_TYPES: Array<{ type: string; tier: 0 | 1 }> = [
  { type: "EXPANSION JOINT", tier: 0 }, { type: "FLEXIBLE JOINT", tier: 0 }, { type: "SIGHT GLASS", tier: 0 },
  { type: "STUB END", tier: 0 }, { type: "ELBOW", tier: 0 }, { type: "FLANGE", tier: 0 },
  { type: "REDUCER", tier: 0 }, { type: "NIPPLE", tier: 0 }, { type: "CLAMP", tier: 0 },
  { type: "SOCKET", tier: 0 }, { type: "COUPLING", tier: 0 }, { type: "COUPLER", tier: 0 },
  { type: "TEE", tier: 0 }, { type: "UNION", tier: 0 }, { type: "ADAPTOR", tier: 0 },
  { type: "CONNECTOR", tier: 0 }, { type: "CAP", tier: 0 }, { type: "PLUG", tier: 0 },
  { type: "BUSH", tier: 0 }, { type: "BEND", tier: 0 }, { type: "CROSS", tier: 0 },
  { type: "VALVE", tier: 0 }, { type: "GASKET", tier: 0 }, { type: "BOLT", tier: 0 },
  { type: "STUD", tier: 0 }, { type: "NUT", tier: 0 }, { type: "WASHER", tier: 0 },
  { type: "STRAINER", tier: 0 }, { type: "HOSE", tier: 0 }, { type: "NOZZLE", tier: 0 },
  { type: "SLEEVE", tier: 0 }, { type: "SPOOL", tier: 0 }, { type: "OLET", tier: 0 },
  { type: "WELDOLET", tier: 0 }, { type: "FERRULE", tier: 0 }, { type: "SPACER", tier: 0 },
  { type: "SADDLE", tier: 0 }, { type: "BELLOW", tier: 0 }, { type: "RING", tier: 0 },
  { type: "PLATE", tier: 0 }, { type: "SEAL", tier: 0 }, { type: "FILTER", tier: 0 },
  { type: "SPRINKLER", tier: 0 }, { type: "SPRAY", tier: 0 }, { type: "DUCT", tier: 0 },
  { type: "GEARBOX", tier: 0 }, { type: "DAMPER", tier: 0 }, { type: "CABLE", tier: 0 },
  { type: "BEARING", tier: 0 }, { type: "MOTOR", tier: 0 }, { type: "PUMP", tier: 0 },
  { type: "ACTUATOR", tier: 0 }, { type: "TRANSFORMER", tier: 0 }, { type: "UNIT", tier: 0 },
  { type: "JOINT", tier: 1 }, { type: "PIPE", tier: 1 }, { type: "TUBE", tier: 1 },
  { type: "FITTING", tier: 1 },
];

// Families a search may legitimately cross. An elbow and a bend are the same part under two names;
// a coupling, coupler and connector are catalogued interchangeably by different plants. Keeping
// these as an explicit graph means the family gate can stay strict without hiding real matches.
const RELATED_ITEM_TYPE_GROUPS: string[][] = [
  ["ELBOW", "BEND"],
  ["ADAPTOR", "CONNECTOR", "COUPLER", "COUPLING"],
  ["REDUCER", "BUSH"],
  ["SOCKET", "COUPLING"],
  ["NIPPLE", "PLUG"],
  ["PIPE", "TUBE"],
  ["FITTING", "PIPE", "TUBE"],
  ["GASKET", "SEAL", "RING"],
  ["STUB END", "SPOOL"],
  ["EXPANSION JOINT", "FLEXIBLE JOINT", "BELLOW"],
];

const RELATED_ITEM_TYPES = new Map<string, Set<string>>();
for (const group of RELATED_ITEM_TYPE_GROUPS) {
  for (const type of group) {
    const bucket = RELATED_ITEM_TYPES.get(type) ?? new Set<string>();
    for (const other of group) bucket.add(other);
    RELATED_ITEM_TYPES.set(type, bucket);
  }
}

const ITEM_TYPE_TIERS = new Map(ITEM_TYPES.map((entry) => [entry.type, entry.tier]));
// Longest first so "EXPANSION JOINT" is recognized before the bare "JOINT" inside it.
const ITEM_TYPES_BY_LENGTH = [...ITEM_TYPES].sort((left, right) => right.type.length - left.type.length);

// SAP escapes characters it cannot store directly as <(>x<)> - "TOP<(>&<)>BOTTOM PLATE" is really
// "TOP&BOTTOM PLATE". Left in place the markers become search noise and split real words.
export function unescapeSapText(value: string): string {
  return value.replace(/<\(>(.)<\)>/g, "$1").replace(/<\(>|<\)>/g, "");
}

function expandToken(token: string): string {
  return ABBREVIATIONS[token] || token;
}

/**
 * Rewrites abbreviations to their canonical English expansion. Used for item-type detection and
 * attribute parsing, where a single spelling per concept is what makes the rules work.
 */
export function expandAbbreviations(value: string): string {
  return unescapeSapText(value.toUpperCase())
    .split(/([^A-Z]+)/)
    .map((part, index) => (index % 2 === 0 ? expandToken(part) : part))
    .join("");
}

/**
 * Text to index for lexical and trigram search. Keeps the original wording *and* appends the
 * expanded form, so "FLNG" and "FLANGE" both retrieve the same row whichever the user types.
 */
export function buildSearchText(...parts: string[]): string {
  const original = unescapeSapText(parts.filter(Boolean).join(" ").toUpperCase());
  const expanded = expandAbbreviations(original);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of `${original} ${expanded}`.split(/[^A-Z0-9/.\-"']+/)) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens.join(" ");
}

export function canonicalItemType(value: string | null | undefined): string | null {
  if (!value) return null;
  const expanded = expandAbbreviations(value).trim();
  if (ITEM_TYPE_TIERS.has(expanded)) return expanded;
  return findItemType(expanded);
}

function findItemType(text: string): string | null {
  let best: { type: string; tier: number; position: number } | null = null;
  for (const { type, tier } of ITEM_TYPES_BY_LENGTH) {
    const match = new RegExp(`(?:^|[^A-Z])${type}(?:$|[^A-Z])`).exec(text);
    if (!match) continue;
    const position = match.index;
    // Specific components outrank generic forms; among equals the earlier word is the head noun.
    if (!best || tier < best.tier || (tier === best.tier && position < best.position)) best = { type, tier, position };
  }
  return best?.type ?? null;
}

/**
 * Resolves the retrieval family from the description itself. This deliberately does not consult the
 * source class column: real ERP exports frequently carry a single constant commodity group (one
 * observed export had "PIPE FITT & NOZZLES" on all 12,257 rows), which makes a class-derived family
 * either a wall that rejects every candidate or a filter that rejects none.
 */
export function deriveItemType(shortDescription: string, longDescription = "", className = ""): string | null {
  return findItemType(expandAbbreviations(shortDescription))
    ?? findItemType(expandAbbreviations(className))
    ?? findItemType(expandAbbreviations(longDescription));
}

export function areRelatedItemTypes(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  if (a === b) return true;
  return RELATED_ITEM_TYPES.get(a)?.has(b) ?? false;
}

export function isGenericItemType(value: string | null): boolean {
  return !!value && ITEM_TYPE_TIERS.get(value.toUpperCase()) === 1;
}

export const CONNECTIONS = ["DOUBLE FLANGED", "FLANGED", "FLANGE", "WAFER", "LUG", "THREADED", "SCREWED", "SOCKET WELD", "BUTT WELD", "SLIP ON", "WELD NECK", "BSPP", "BSPT", "BSP", "NPT", "RTJ", "RF"];
export const ACTUATIONS = ["ELECTRIC", "PNEUMATIC", "HYDRAULIC", "MANUAL", "LEVER", "GEAR OPERATED", "GEARBOX", "AUTOMATIC", "PILOT OPERATED"];
export const KNOWN_MATERIALS = ["CF8M", "CF8", "SS 316L", "SS316L", "SS 316", "SS316", "SS 304", "SS304", "STAINLESS STEEL", "SS", "CARBON STEEL", "MILD STEEL", "DUCTILE IRON", "NODULAR CI", "CAST IRON", "GALVANISED IRON", "COPPER", "ALUMINIUM", "POLYPROPYLENE", "POLYETHYLENE", "HDPE", "GRP", "CI", "DI", "EPDM", "NBR", "PTFE", "PFA", "VITON", "FKM", "BRONZE", "BRASS", "WCB", "WC6", "WPB", "CS", "PVC", "CPVC"];

// Seed vocabulary for the cases where no corpus is available yet: unit tests, and any query issued
// before the first import completes. deriveSubtypeVocabulary() supersedes this with terms mined
// from the actual catalog.
export const FALLBACK_SUBTYPES = [
  "BUTTERFLY", "SOLENOID", "CHECK", "CONTROL", "RELIEF", "BALL", "GATE", "GLOBE", "NEEDLE", "PLUG",
  "DIAPHRAGM", "KNIFE GATE", "NON RETURN", "REDUCING", "CONCENTRIC", "ECCENTRIC", "EQUAL",
  "UNEQUAL", "SLIP ON", "WELD NECK", "BLIND", "SEAMLESS", "HEXAGON", "LONG RADIUS", "SHORT RADIUS",
  "MALE", "FEMALE", "STRAIGHT", "MITRE", "HEAVY DUTY",
];

// Words that describe how an item is made, connected, or what it is made of - rather than what kind
// of item it is. They are excluded from the mined subtype vocabulary because each is already scored
// as its own attribute, and a term serving as both a subtype and a material or connection produces
// spurious subtype disagreement between two otherwise identical parts.
const SUBTYPE_STOPWORDS = new Set([
  "AND", "FOR", "TYPE", "WITH", "PER", "THE", "NOS", "NOT", "USE", "SET", "ASS", "GEN",
  "MISC", "MISCELLANEOUS", "OTHER", "OTHERS", "GENERIC", "MATERIAL", "MATERIALS", "ITEM",
  "STANDARD", "DRAWING", "MAKE", "SIZE", "CLASS", "GRADE", "LENGTH", "DEGREE", "DIAMETER",
  "THICKNESS", "OUTSIDE", "INSIDE", "WALL", "SCHEDULE", "RATING", "SPARE", "SPARES", "REPAIR",
  "KIT", "KITS", "ASSEMBLY", "ASSEMBLIES", "INFORMATION", "ADDITIONAL", "SPECIFICATION",
  "PROCESS", "MANUFACTURING", "SURFACE", "TREATMENT", "CONNECTION", "PRESSURE", "NOMINAL",
  // Units and dimension prefixes: these are numbers' companions, never a kind of item.
  "MM", "CM", "IN", "INCH", "INCHES", "DN", "NB", "NPS", "OD", "ID", "SCH", "DEG", "THK",
  "BAR", "PSI", "LB", "LBS", "CL", "PN", "KG", "MTR", "MTRS", "METER", "METRE", "NUMBER",
  // Every controlled term list: already scored, so never also a subtype.
  ...CONNECTIONS, ...ACTUATIONS, ...KNOWN_MATERIALS,
  ...KNOWN_MATERIALS.flatMap((material) => material.split(" ")),
  ...CONNECTIONS.flatMap((connection) => connection.split(" ")),
]);

// A mined term has to be short enough to be a real word. The catalog's long text is assembled from
// fixed-width lines whose seams lose spaces, which manufactures tokens like "BUTTWELDCS" and
// "MMTHREADED"; length alone rejects them cheaply.
const MAX_SUBTYPE_TERM_LENGTH = 14;
// A term present on a quarter of the catalog does not distinguish anything, so it is not worth the
// weight the matcher would give it.
const MAX_SUBTYPE_DOCUMENT_FREQUENCY = 0.25;

/**
 * Learns subtype terms from the corpus. The previous implementation split the source class column
 * on commas, which yields nothing for exports whose class column is a single constant value. Real
 * subtype signal lives in the description modifiers ("REDUCING" tee, "SLIP ON" flange,
 * "CONCENTRIC" reducer), so the vocabulary is mined from there, then filtered by length, document
 * frequency and the stopword list above to keep glued fragments and part numbers out.
 */
export function deriveSubtypeVocabulary(descriptions: string[], minimumOccurrences = 5): string[] {
  const documentCounts = new Map<string, number>();
  let documents = 0;
  for (const description of descriptions) {
    if (!description?.trim()) continue;
    documents += 1;
    const expanded = expandAbbreviations(description);
    const itemType = findItemType(expanded);
    const seen = new Set<string>();
    for (const token of expanded.split(/[^A-Z]+/)) {
      if (token.length < 3 || token.length > MAX_SUBTYPE_TERM_LENGTH) continue;
      if (seen.has(token) || SUBTYPE_STOPWORDS.has(token) || ITEM_TYPE_TIERS.has(token) || token === itemType) continue;
      seen.add(token);
      documentCounts.set(token, (documentCounts.get(token) || 0) + 1);
    }
  }
  const ceiling = Math.max(minimumOccurrences, documents * MAX_SUBTYPE_DOCUMENT_FREQUENCY);
  const mined = [...documentCounts]
    .filter(([, count]) => count >= minimumOccurrences && count <= ceiling)
    .map(([term]) => term);
  return [...new Set([...FALLBACK_SUBTYPES, ...mined])];
}

export const ITEM_TYPE_LIST = ITEM_TYPES.map((entry) => entry.type);
