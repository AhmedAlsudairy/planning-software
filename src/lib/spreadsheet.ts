import ExcelJS from "exceljs";
import Papa from "papaparse";
import { deriveSubtypeVocabulary, isActiveStatus, parseAttributes } from "@/lib/normalization";
import type { MaterialImportRow } from "@/types/material";

const REQUIRED_COLUMNS = ["Corporate No", "SAP No", "Class", "Short Description", "Long Description", "Status"];
const MAX_ROWS = 100_000;

function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function normalizeRecord(source: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [cleanHeader(key), value == null ? "" : String(value).trim()]));
}

function toMaterial(source: Record<string, unknown>, subtypeVocabulary: string[]): MaterialImportRow | null {
  const row = normalizeRecord(source);
  if (!row["Corporate No"] && !row["SAP No"] && !row["Long Description"]) return null;
  const className = row.Class || row["Item Type"] || "";
  const shortDescription = row["Short Description"] || "";
  const longDescription = row["Long Description"] || shortDescription;
  return {
    corporateNo: row["Corporate No"] || "",
    sapNo: row["SAP No"] || "",
    plant: row.Plant || "",
    className,
    shortDescription,
    longDescription,
    uom: row.UOM || "",
    materialType: row["Material Type"] || "",
    unspsc: row.UNSPSC || "",
    status: row.Status || "",
    statusDescription: row["Status Description"] || "",
    itemTypeSource: row["Item Type"] || "",
    attributes: parseAttributes(`${shortDescription} ${longDescription}`, className, subtypeVocabulary),
    statusActive: isActiveStatus(row.Status || ""),
    rawData: row,
  };
}

function validateHeaders(headers: string[]): void {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
}

async function parseExcel(buffer: Buffer): Promise<{ rows: MaterialImportRow[]; sheetName: string; warnings: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet");
  if (worksheet.rowCount - 1 > MAX_ROWS) throw new Error(`The worksheet exceeds the ${MAX_ROWS.toLocaleString()} row limit`);
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) => cleanHeader(headerRow.getCell(index + 1).text));
  validateHeaders(headers);
  const records: Record<string, string>[] = [];
  for (let index = 2; index <= worksheet.rowCount; index += 1) {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      record[header] = worksheet.getRow(index).getCell(columnIndex + 1).text.trim();
    });
    records.push(record);
  }
  const subtypeVocabulary = deriveSubtypeVocabulary(records.map((record) => record.Class || record["Item Type"] || ""));
  const rows = records.map((record) => toMaterial(record, subtypeVocabulary)).filter((row): row is MaterialImportRow => Boolean(row));
  return { rows, sheetName: worksheet.name, warnings: workbook.worksheets.length > 1 ? ["Only the first worksheet was imported"] : [] };
}

function fatalCsvErrors(errors: Papa.ParseError[]): Papa.ParseError[] {
  return errors.filter((error) => error.code !== "UndetectableDelimiter");
}

function parseCsv(buffer: Buffer): { rows: MaterialImportRow[]; sheetName: string; warnings: string[] } {
  const result = Papa.parse<Record<string, string>>(buffer.toString("utf8"), { header: true, skipEmptyLines: "greedy", transformHeader: cleanHeader });
  const errors = fatalCsvErrors(result.errors);
  if (errors.length) throw new Error(`CSV parsing failed: ${errors[0].message}`);
  if (result.data.length > MAX_ROWS) throw new Error(`The CSV exceeds the ${MAX_ROWS.toLocaleString()} row limit`);
  validateHeaders(result.meta.fields || []);
  const subtypeVocabulary = deriveSubtypeVocabulary(result.data.map((record) => record.Class || record["Item Type"] || ""));
  return { rows: result.data.map((record) => toMaterial(record, subtypeVocabulary)).filter((row): row is MaterialImportRow => Boolean(row)), sheetName: "CSV", warnings: [] };
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet");
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) => cleanHeader(headerRow.getCell(index + 1).text));
  const column = pickSearchColumn(headers);
  const items: string[] = [];
  for (let index = 2; index <= worksheet.rowCount && items.length < MAX_SEARCH_ITEMS; index += 1) {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => { record[header] = worksheet.getRow(index).getCell(columnIndex + 1).text.trim(); });
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
