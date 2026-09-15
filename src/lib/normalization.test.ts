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

describe("parseAttributes fuzzy matching (query-time typo tolerance)", () => {
  it("does not recognize a misspelled subtype when fuzzy matching is off (import-time default)", () => {
    expect(parseAttributes("BUTTRFLY VALVE DN150").subtype).toBeNull();
  });

  it("recognizes a misspelled subtype when fuzzy matching is requested", () => {
    const result = parseAttributes("BUTTRFLY VALVE DN150", "", undefined, true);
    expect(result.subtype).toBe("BUTTERFLY");
    expect(result.itemType).toBe("VALVE");
  });

  it("recognizes a misspelled connection type", () => {
    expect(parseAttributes("VALVE DN150 FLANGD", "", undefined, true).connection).toBe("FLANGED");
  });

  it("recognizes a misspelled item type keyword", () => {
    expect(parseAttributes("VALEV DN150", "", undefined, true).itemType).toBe("VALVE");
  });

  it("does not fuzzy-match very short vocabulary codes", () => {
    // 2-3 letter material codes (SS, CI, DI...) have too dense a neighborhood of unrelated real
    // words within one edit to fuzz safely - they stay exact-only regardless of the flag.
    expect(parseAttributes("SIX INCH FLANGE", "", undefined, true).materials).not.toContain("SS");
  });

  it("still requires an exact match for multi-word subtype terms", () => {
    expect(parseAttributes("KNIF GATE VALVE DN150", "", ["KNIFE GATE"], true).subtype).toBeNull();
  });
});

describe("isActiveStatus", () => {
  it("excludes deleted and deletion-staged records", () => {
    expect(isActiveStatus("A0-DELETED")).toBe(false);
    expect(isActiveStatus("C2-RFD STAGED")).toBe(false);
    expect(isActiveStatus("B2-ERP ACCEPTED")).toBe(true);
  });
});
