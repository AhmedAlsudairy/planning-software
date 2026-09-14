import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseMaterialFile } from "@/lib/spreadsheet";

const headers = ["Corporate No", "SAP No", "Plant", "Class", "Short Description", "Long Description", "UOM", "Material Type", "UNSPSC", "Status", "Status Description", "Item Type"];

describe("parseMaterialFile", () => {
  it("maps the supplied iDXP column format", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Results");
    worksheet.addRow(headers);
    worksheet.addRow(["M100", "000200", "8501", "VALVE, BUTTERFLY", "VLV BTRFLY;WFR,300MM", "VALVE, BUTTERFLY; SIZE: 300 MM PRESSURE RATING: PN10 CONNECTION TYPE: WAFER", "EA", "ZSPR", "40141600", "B2-ERP ACCEPTED", "New Sap Code Created", "GENERIC"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseMaterialFile("materials.xlsx", buffer);
    expect(result.sheetName).toBe("Results");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ corporateNo: "M100", sapNo: "000200", plant: "8501", statusActive: true });
    expect(result.rows[0].attributes).toMatchObject({ itemType: "VALVE", subtype: "BUTTERFLY", sizeMm: 300, pressureClass: "PN10", connection: "WAFER" });
  });
});
