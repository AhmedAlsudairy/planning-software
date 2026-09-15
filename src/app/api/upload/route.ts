import { ImportInProgressError, importMaterials } from "@/lib/db";
import { parseMaterialFile } from "@/lib/spreadsheet";
import type { UploadSummary } from "@/types/material";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 60 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Select an Excel or CSV file" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return Response.json({ error: "The file exceeds the 60 MB limit" }, { status: 413 });
    const parsed = await parseMaterialFile(file.name, Buffer.from(await file.arrayBuffer()));
    if (!parsed.rows.length) return Response.json({ error: "No material rows were found" }, { status: 400 });
    const uploadId = await importMaterials(file.name, parsed.sheetName, parsed.rows);
    const activeRows = parsed.rows.filter((row) => row.statusActive).length;
    const summary: UploadSummary = {
      uploadId,
      fileName: file.name,
      sheetName: parsed.sheetName,
      importedRows: parsed.rows.length,
      activeRows,
      inactiveRows: parsed.rows.length - activeRows,
      uniqueMaterials: new Set(parsed.rows.map((row) => `${row.corporateNo}|${row.sapNo}`)).size,
      warnings: parsed.warnings,
    };
    return Response.json(summary);
  } catch (error) {
    if (error instanceof ImportInProgressError) return Response.json({ error: error.message }, { status: 409 });
    const message = error instanceof Error ? error.message : "Upload failed";
    const safeMessage = message.includes("DATABASE_URL") || message.startsWith("Missing") || message.includes("worksheet") || message.includes("CSV") || message.includes("supported") || message.includes("rolled back") ? message : "The material file could not be imported";
    return Response.json({ error: safeMessage }, { status: 500 });
  }
}
