import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseMaterialFile, resolveColumns } from "@/lib/spreadsheet";

const IDXP_HEADERS = ["Corporate No", "SAP No", "Plant", "Class", "Short Description", "Long Description", "UOM", "Material Type", "UNSPSC", "Status", "Status Description", "Item Type"];
// The plant MM export: different column names, no corporate number, no usable class column.
const SAP_HEADERS = ["Material Number", "Plant", "Material Group", "Unit of Measurement", "Material Status", "Material Description", "Material Text", "Description", "Created On"];

async function workbookBuffer(headers: string[], rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("resolveColumns", () => {
  it("maps both export layouts onto the same logical fields", () => {
    expect(resolveColumns(IDXP_HEADERS)).toMatchObject({ sapNo: "SAP No", shortDescription: "Short Description", className: "Class" });
    expect(resolveColumns(SAP_HEADERS)).toMatchObject({ sapNo: "Material Number", shortDescription: "Material Description", longDescription: "Material Text" });
  });

  // "Description" is the commodity-group label when a more specific description column exists, and
  // the item description itself when it is the only one.
  it("resolves a bare Description column by what else the file has", () => {
    expect(resolveColumns(SAP_HEADERS).materialGroupDescription).toBe("Description");
    expect(resolveColumns(SAP_HEADERS).shortDescription).toBe("Material Description");
    expect(resolveColumns(["SAP No", "Description"]).shortDescription).toBe("Description");
  });

  it("ignores case, punctuation and spacing in header names", () => {
    expect(resolveColumns(["material_number", "MATERIAL DESCRIPTION"])).toMatchObject({ sapNo: "material_number", shortDescription: "MATERIAL DESCRIPTION" });
  });
});

describe("parseMaterialFile", () => {
  it("maps the iDXP column format", async () => {
    const buffer = await workbookBuffer(IDXP_HEADERS, [
      ["M100", "000200", "8501", "VALVE, BUTTERFLY", "VLV BTRFLY;WFR,300MM", "VALVE, BUTTERFLY; SIZE: 300 MM PRESSURE RATING: PN10 CONNECTION TYPE: WAFER", "EA", "ZSPR", "40141600", "B2-ERP ACCEPTED", "New Sap Code Created", "GENERIC"],
      ["M101", "000201", "8501", "VALVE, BALL", "VLV BALL;300MM", "VALVE, BALL; SIZE: 300 MM", "EA", "ZSPR", "40141600", "B2-ERP ACCEPTED", "New Sap Code Created", "GENERIC"],
    ]);
    const result = await parseMaterialFile("materials.xlsx", buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ corporateNo: "M100", sapNo: "000200", plant: "8501", statusActive: true });
    // Two distinct classes, so the source class column is trusted as the family label.
    expect(result.rows[0].className).toBe("VALVE, BUTTERFLY");
    expect(result.rows[0].attributes).toMatchObject({ itemType: "VALVE", subtype: "BUTTERFLY", sizeMm: 300, pressureClass: "PN10", connection: "WAFER" });
  });

  it("maps the SAP plant export, which has no corporate number and no usable class column", async () => {
    const buffer = await workbookBuffer(SAP_HEADERS, [
      ["20026598", "8502", "125", "EA", "", "FLNG PIPE;SLP-ON,RSD FACE,DN40,CS,CL 150", "FLANGE, PIPE;\nSTYLE: RAISED FACE\nNOMINAL PIPE SIZE:DN40\nMATERIAL: CS\nPRESSURE RATING: CL 150", "PIPE FITT & NOZZLES", "Tue Mar 17 2015"],
      ["20017612", "8502", "125", "EA", "", "ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS", "ELBOW, PIPE;\nANGLE: 90 DEG\nNOMINAL PIPE SIZE: DN200", "PIPE FITT & NOZZLES", "Wed Jan 11 2023"],
    ]);
    const result = await parseMaterialFile("EXPORT.XLSX", buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ sapNo: "20026598", corporateNo: "", plant: "8502", uom: "EA", materialGroup: "125", materialGroupDescription: "PIPE FITT & NOZZLES" });
    expect(result.warnings.join(" ")).toContain("corporate number");
    // The class column is one constant value across the file, so the family is derived instead.
    expect(result.rows[0].className).toBe("FLANGE");
    expect(result.rows[1].className).toBe("ELBOW");
    expect(result.rows[0].attributes).toMatchObject({ itemType: "FLANGE", sizeMm: 40, pressureClass: "CLASS 150" });
    expect(result.rows[1].attributes).toMatchObject({ itemType: "ELBOW", sizeMm: 200, angleDeg: 90, schedule: "SCH 40" });
  });

  it("keeps a blocked material importable and searchable", async () => {
    const buffer = await workbookBuffer(SAP_HEADERS, [
      ["20010800", "8501", "125", "EA", "Blocked for Procurement", "TEE PIPE;DN50", "TEE, PIPE", "PIPE FITT & NOZZLES", ""],
    ]);
    const result = await parseMaterialFile("EXPORT.XLSX", buffer);
    expect(result.rows[0]).toMatchObject({ status: "Blocked for Procurement", statusActive: true });
  });

  it("strips the SAP escape markers from cell text", async () => {
    const buffer = await workbookBuffer(SAP_HEADERS, [
      ["20061619", "8502", "125", "EA", "", "CLAMP PIPE PP:3INCH", "CLAMP,PIPE,PP,3\",HD,TOP<(>&<)>BOTTOM PLATE", "PIPE FITT & NOZZLES", ""],
    ]);
    const result = await parseMaterialFile("EXPORT.XLSX", buffer);
    expect(result.rows[0].longDescription).toContain("TOP&BOTTOM");
    expect(result.rows[0].longDescription).not.toContain("<(>");
  });

  it("names what is missing when the file cannot be identified or searched", async () => {
    const buffer = await workbookBuffer(["Plant", "Created On"], [["8501", ""]]);
    await expect(parseMaterialFile("wrong.xlsx", buffer)).rejects.toThrow(/material code column/);
  });

  it("rejects an unsupported file type", async () => {
    await expect(parseMaterialFile("materials.pdf", Buffer.from(""))).rejects.toThrow(/supported/);
  });
});
