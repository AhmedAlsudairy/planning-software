import { describe, expect, it } from "vitest";
import { isActiveStatus, parseAttributes } from "@/lib/normalization";

describe("parseAttributes", () => {
  it("extracts the supplied butterfly valve specification", () => {
    const result = parseAttributes("VALVE, BUTTERFLY, DN300, PN10, WAFER, EN593, BODY: CI, DISC/STEM: SS, EPDM, FF:78MM");
    expect(result.itemType).toBe("VALVE");
    expect(result.subtype).toBe("BUTTERFLY");
    expect(result.sizeMm).toBe(300);
    expect(result.pressureClass).toBe("PN10");
    expect(result.connection).toBe("WAFER");
    expect(result.faceToFaceMm).toBe(78);
    expect(result.standards).toContain("EN593");
    expect(result.materials).toEqual(expect.arrayContaining(["CI", "EPDM"]));
  });

  it("normalizes inch sizes and pressure units", () => {
    const result = parseAttributes("VALVE, BALL; SIZE: 12 IN PRESSURE RATING: 150 PSI CONNECTION TYPE: FLANGED");
    expect(result.sizeMm).toBe(304.8);
    expect(result.pressureBar).toBeCloseTo(10.34, 2);
    expect(result.connection).toBe("FLANGED");
  });
});

describe("parseAttributes abbreviation handling", () => {
  it("does not read a connection type out of an abbreviation", () => {
    const result = parseAttributes("VLV BTRFLY;DWG:0.515262.B;DN300,PN6", "VALVE, BUTTERFLY");
    expect(result.connection).toBeNull();
    expect(result.subtype).toBe("BUTTERFLY");
    expect(result.sizeMm).toBe(300);
    expect(result.pressureClass).toBe("PN6");
  });

  it("recognizes the wafer connection when it is stated", () => {
    expect(parseAttributes("VLV BTRFLY;WFR,300MM,150LB,78MM CONNECTION TYPE: WAFER", "VALVE, BUTTERFLY").connection).toBe("WAFER");
  });
});

describe("isActiveStatus", () => {
  it("excludes deleted and deletion-staged records", () => {
    expect(isActiveStatus("A0-DELETED")).toBe(false);
    expect(isActiveStatus("C2-RFD STAGED")).toBe(false);
    expect(isActiveStatus("B2-ERP ACCEPTED")).toBe(true);
  });
});
