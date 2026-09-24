import ExcelJS from "exceljs";
import Papa from "papaparse";
import { deriveSubtypeVocabulary, isActiveStatus, parseAttributes } from "@/lib/normalization";
import { deriveItemType, unescapeSapText } from "@/lib/vocabulary";
import type { MaterialImportRow } from "@/types/material";

const MAX_ROWS = 100_000;

type LogicalField =
  | "corporateNo" | "sapNo" | "plant" | "className" | "shortDescription" | "longDescription"
  | "uom" | "materialType" | "materialGroup" | "materialGroupDescription" | "unspsc"
  | "status" | "statusDescription" | "itemTypeSource";

// ERP exports of the same catalog arrive under different column names depending on which report
// produced them - an iDXP extract calls the code "SAP No" while a plant MM report calls it
// "Material Number". Resolving headers to logical fields instead of hard-coding one layout means a
// new export format is a dictionary entry, not a parser change.
const COLUMN_ALIASES: Record<LogicalField, string[]> = {
  corporateNo: ["CORPORATE NO", "CORPORATE NUMBER", "CORP NO", "CORPORATE CODE"],
  sapNo: ["SAP NO", "SAP NUMBER", "SAP CODE", "MATERIAL NUMBER", "MATERIAL NO", "MATERIAL CODE", "MATNR"],
  plant: ["PLANT", "PLANT CODE", "WERKS"],
  className: ["CLASS", "CLASS NAME", "ITEM CLASS", "ITEM CATEGORY"],
  shortDescription: ["SHORT DESCRIPTION", "MATERIAL DESCRIPTION", "SHORT TEXT", "MATERIAL SHORT TEXT", "MAKTX"],
  longDescription: ["LONG DESCRIPTION", "MATERIAL TEXT", "LONG TEXT", "PO TEXT", "BASIC DATA TEXT", "ITEM TEXT"],
  uom: ["UOM", "UNIT OF MEASUREMENT", "UNIT OF MEASURE", "BASE UNIT OF MEASURE", "MEINS"],
  materialType: ["MATERIAL TYPE", "MTART"],
  materialGroup: ["MATERIAL GROUP", "MATL GROUP", "MATKL"],
  materialGroupDescription: ["MATERIAL GROUP DESCRIPTION", "MATERIAL GROUP DESC", "GROUP DESCRIPTION", "COMMODITY GROUP"],
  unspsc: ["UNSPSC", "UNSPSC CODE"],
  status: ["STATUS", "MATERIAL STATUS", "PLANT SPECIFIC MATERIAL STATUS", "CROSS PLANT STATUS", "MSTAE"],
  statusDescription: ["STATUS DESCRIPTION", "STATUS DESC"],
  itemTypeSource: ["ITEM TYPE", "ITEM TYPE SOURCE"],
};

// A bare "Description" column means different things in different exports. In the observed SAP
// export it is the commodity-group label ("PIPE FITT & NOZZLES", identical on all 12,257 rows)
// alongside a separate "Material Description"; in a leaner export it is the item description
// itself. Resolve it to the first of these slots that nothing else has already claimed.
const AMBIGUOUS_HEADERS: Record<string, LogicalField[]> = {
  DESCRIPTION: ["shortDescription", "materialGroupDescription"],
  TEXT: ["longDescription"],
};

function cleanHeader(value: string): string {
  return value.replace(/^﻿/, "").replace(/\s+/g, " ").trim();
}

function headerKey(value: string): string {
  return cleanHeader(value).toUpperCase().replace(/[._-]+/g, " ").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

const ALIAS_LOOKUP = new Map<string, LogicalField>();
for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[LogicalField, string[]]>) {
  for (const alias of aliases) ALIAS_LOOKUP.set(headerKey(alias), field);
}

export type ColumnMap = Partial<Record<LogicalField, string>>;

export function resolveColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const deferred: Array<[string, LogicalField[]]> = [];
  for (const header of headers) {
    const key = headerKey(header);
    if (!key) continue;
    const field = ALIAS_LOOKUP.get(key);
    if (field) {
      if (!map[field]) map[field] = cleanHeader(header);
      continue;
    }
    const candidates = AMBIGUOUS_HEADERS[key];
    if (candidates) deferred.push([cleanHeader(header), candidates]);
  }
  for (const [header, candidates] of deferred) {
    const slot = candidates.find((field) => !map[field]);
    if (slot) map[slot] = header;
  }
  return map;
}

// The old contract demanded six exact headers and rejected anything else, which is why a valid SAP
// export failed to import at all. What an import actually needs is a way to identify the material
// and something to search on; everything else is optional enrichment.
function validateColumns(map: ColumnMap, headers: string[]): void {
  const hasIdentifier = Boolean(map.sapNo || map.corporateNo);
  const hasDescription = Boolean(map.shortDescription || map.longDescription);
  if (hasIdentifier && hasDescription) return;
  const missing = [
    hasIdentifier ? null : "a material code column (e.g. SAP No, Material Number)",
    hasDescription ? null : "a description column (e.g. Short Description, Material Description)",
  ].filter(Boolean);
  throw new Error(`Missing required columns: the file needs ${missing.join(" and ")}. Columns found: ${headers.filter(Boolean).join(", ")}`);
}

function cell(record: Record<string, string>, map: ColumnMap, field: LogicalField): string {
  const column = map[field];
  return column ? record[column] || "" : "";
}

/**
 * The source class column is only usable as a search family when it actually discriminates. The
 * observed SAP export carries one constant commodity group on every row, which made the previous
 * class-based family filter either reject every candidate or reject none. When the column does not
 * vary, the family is derived from the description instead.
 */
function buildRows(records: Record<string, string>[], map: ColumnMap): MaterialImportRow[] {
  const sourceClasses = new Set(records.map((record) => cell(record, map, "className") || cell(record, map, "itemTypeSource")).filter(Boolean));
  const useSourceClass = sourceClasses.size > 1;
  const subtypeVocabulary = deriveSubtypeVocabulary(records.map((record) => `${cell(record, map, "shortDescription")} ${cell(record, map, "className")}`));
  const rows: MaterialImportRow[] = [];
  for (const record of records) {
    const sapNo = cell(record, map, "sapNo");
    const corporateNo = cell(record, map, "corporateNo");
    const shortDescription = cell(record, map, "shortDescription");
    const longDescription = cell(record, map, "longDescription") || shortDescription;
    if (!corporateNo && !sapNo && !longDescription) continue;
    const sourceClass = cell(record, map, "className") || cell(record, map, "itemTypeSource");
    const className = (useSourceClass ? sourceClass : deriveItemType(shortDescription, longDescription, sourceClass)) || sourceClass || "UNCLASSIFIED";
    const status = cell(record, map, "status");
    rows.push({
      corporateNo,
      sapNo,
      plant: cell(record, map, "plant"),
      className,
      materialGroup: cell(record, map, "materialGroup"),
      materialGroupDescription: cell(record, map, "materialGroupDescription"),
      shortDescription,
      longDescription,
      uom: cell(record, map, "uom"),
      materialType: cell(record, map, "materialType"),
      unspsc: cell(record, map, "unspsc"),
      status,
      statusDescription: cell(record, map, "statusDescription"),
      itemTypeSource: cell(record, map, "itemTypeSource"),
      attributes: parseAttributes(`${shortDescription}\n${longDescription}`, className, subtypeVocabulary),
      statusActive: isActiveStatus(status),
      rawData: record,
    });
  }
  return rows;
}

// exceljs preserves the newlines inside a multi-line SAP long-text cell, and those newlines are the
// separators that make "LABEL: VALUE" blocks parseable - so only runs of spaces are collapsed here.
function cellText(row: ExcelJS.Row, index: number): string {
  return unescapeSapText(row.getCell(index).text).replace(/[ \t]+/g, " ").trim();
}

function readHeaders(worksheet: ExcelJS.Worksheet): string[] {
  const headerRow = worksheet.getRow(1);
  return Array.from({ length: worksheet.columnCount }, (_, index) => cleanHeader(headerRow.getCell(index + 1).text));
}

async function loadWorksheet(buffer: Buffer): Promise<{ worksheet: ExcelJS.Worksheet; headers: string[]; sheetCount: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet");
  return { worksheet, headers: readHeaders(worksheet), sheetCount: workbook.worksheets.length };
}

function readRecords(worksheet: ExcelJS.Worksheet, headers: string[]): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  for (let index = 2; index <= worksheet.rowCount; index += 1) {
    const row = worksheet.getRow(index);
    const record: Record<string, string> = {};
    let populated = false;
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const value = cellText(row, columnIndex + 1);
      record[header] = value;
      if (value) populated = true;
    });
    if (populated) records.push(record);
  }
  return records;
}

async function parseExcel(buffer: Buffer): Promise<{ rows: MaterialImportRow[]; sheetName: string; warnings: string[] }> {
  const { worksheet, headers, sheetCount } = await loadWorksheet(buffer);
  if (worksheet.rowCount - 1 > MAX_ROWS) throw new Error(`The worksheet exceeds the ${MAX_ROWS.toLocaleString()} row limit`);
  const map = resolveColumns(headers);
  validateColumns(map, headers);
  const rows = buildRows(readRecords(worksheet, headers), map);
  const warnings = sheetCount > 1 ? ["Only the first worksheet was imported"] : [];
  if (!map.corporateNo) warnings.push("No corporate number column was found; materials are identified by their SAP code alone.");
  return { rows, sheetName: worksheet.name, warnings };
}

function fatalCsvErrors(errors: Papa.ParseError[]): Papa.ParseError[] {
  return errors.filter((error) => error.code !== "UndetectableDelimiter");
}

function parseCsv(buffer: Buffer): { rows: MaterialImportRow[]; sheetName: string; warnings: string[] } {
  const result = Papa.parse<Record<string, string>>(buffer.toString("utf8"), { header: true, skipEmptyLines: "greedy", transformHeader: cleanHeader });
  const errors = fatalCsvErrors(result.errors);
  if (errors.length) throw new Error(`CSV parsing failed: ${errors[0].message}`);
  if (result.data.length > MAX_ROWS) throw new Error(`The CSV exceeds the ${MAX_ROWS.toLocaleString()} row limit`);
  const headers = result.meta.fields || [];
  const map = resolveColumns(headers);
  validateColumns(map, headers);
  const records = result.data.map((record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, unescapeSapText(value == null ? "" : String(value)).trim()])));
  const warnings = map.corporateNo ? [] : ["No corporate number column was found; materials are identified by their SAP code alone."];
  return { rows: buildRows(records, map), sheetName: "CSV", warnings };
}

export async function parseMaterialFile(fileName: string, buffer: Buffer) {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "xlsx") return parseExcel(buffer);
  if (extension === "csv") return parseCsv(buffer);
  throw new Error("Only .xlsx and .csv files are supported");
}

const SEARCH_ITEM_COLUMNS = ["specification", "spec", "description", "query", "item", "material"];
const MAX_SEARCH_ITEMS = 200;

function pickSearchColumn(headers: string[]): string | null {
  const lower = headers.map((header) => header.toLowerCase());
  for (const candidate of SEARCH_ITEM_COLUMNS) {
    const index = lower.findIndex((header) => header.includes(candidate));
    if (index !== -1) return headers[index];
  }
  return null;
}

function rowToSearchItem(record: Record<string, string>, column: string | null): string {
  if (column) return record[column] || "";
  return Object.values(record).filter(Boolean).join(", ");
}

async function extractSearchItemsFromExcel(buffer: Buffer): Promise<string[]> {
  const { worksheet, headers } = await loadWorksheet(buffer);
  const column = pickSearchColumn(headers);
  const items: string[] = [];
  for (let index = 2; index <= worksheet.rowCount && items.length < MAX_SEARCH_ITEMS; index += 1) {
    const row = worksheet.getRow(index);
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => { if (header) record[header] = cellText(row, columnIndex + 1); });
    const item = rowToSearchItem(record, column).trim();
    if (item.length >= 3) items.push(item);
  }
  return items;
}

function extractSearchItemsFromCsv(buffer: Buffer): string[] {
  const result = Papa.parse<Record<string, string>>(buffer.toString("utf8"), { header: true, skipEmptyLines: "greedy", transformHeader: cleanHeader });
  const errors = fatalCsvErrors(result.errors);
  if (errors.length) throw new Error(`CSV parsing failed: ${errors[0].message}`);
  const column = pickSearchColumn(result.meta.fields || []);
  return result.data
    .map((record) => rowToSearchItem(record, column).trim())
    .filter((item) => item.length >= 3)
    .slice(0, MAX_SEARCH_ITEMS);
}

export async function parseSearchItemsFile(fileName: string, buffer: Buffer): Promise<string[]> {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "xlsx") return extractSearchItemsFromExcel(buffer);
  if (extension === "csv") return extractSearchItemsFromCsv(buffer);
  throw new Error("Only .xlsx and .csv files are supported");
}
