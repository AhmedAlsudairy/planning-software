import type { MaterialAttributes } from "@/types/material";

const CONNECTIONS = ["DOUBLE FLANGED", "FLANGED", "FLANGE", "WAFER", "LUG", "THREADED", "SCREWED", "SOCKET WELD", "BUTT WELD", "BSP", "NPT", "RTJ", "RF"];
const SUBTYPES = ["BUTTERFLY", "SOLENOID", "CHECK", "CONTROL", "RELIEF", "BALL", "GATE", "GLOBE", "NEEDLE", "PLUG", "DIAPHRAGM", "KNIFE GATE", "NON RETURN"];
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

function parsePressure(text: string): Pick<MaterialAttributes, "pressureBar" | "pressureClass"> {
  const pn = text.match(/\bPN\s*[-:]?\s*(\d+(?:\.\d+)?)\b/i);
  if (pn) return { pressureBar: Number(pn[1]), pressureClass: `PN${displayNumber(Number(pn[1]))}` };
  const asme = text.match(/\b(?:CLASS|CL)\s*[-:]?\s*(\d+)\b|\b(\d+)\s*(?:LB|LBS|#)\b/i);
  if (asme) {
    const rating = asme[1] || asme[2];
    return { pressureBar: null, pressureClass: `CLASS ${rating}` };
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

export function parseAttributes(value: string, className = ""): MaterialAttributes {
  const text = normalizeText(`${className} ${value}`);
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
    subtype: findTerm(text, SUBTYPES) || (containsTerm(text, "BTRFLY") ? "BUTTERFLY" : null),
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
