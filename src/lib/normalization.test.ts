import { describe, expect, it } from "vitest";
import { isActiveStatus, isBlockedStatus, parseAttributes } from "@/lib/normalization";

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

describe("parseAttributes size parsing", () => {
  // The previous regex read "1/4IN" as "4 IN" because "/" is a word boundary, so a quarter-inch
  // item was indexed 25x too large and was indistinguishable from a genuine 4-inch item.
  it("reads a fractional inch size as the fraction, not its denominator", () => {
    expect(parseAttributes("TUBE MTLC;1/4IN,CU,ASTM-B75 B68").sizeMm).toBe(6.35);
    expect(parseAttributes("NPLE PIPE HEX;1/2IN,BSP,CS").sizeMm).toBe(12.7);
  });

  it("still reads a whole inch size correctly", () => {
    expect(parseAttributes("PIPE MTLC;4IN,SCH 40,CS").sizeMm).toBe(101.6);
  });

  it("distinguishes a quarter inch from four inches", () => {
    expect(parseAttributes("TUBE 1/4 INCH").sizeMm).not.toBe(parseAttributes("TUBE 4 INCH").sizeMm);
  });

  it("reads a mixed fraction", () => {
    expect(parseAttributes("ELBOW 1-1/2IN CS").sizeMm).toBe(38.1);
  });

  it("reads both bores of a reducing fitting", () => {
    const result = parseAttributes("Tee,Reducing,SS,3000#,THRD A105,40x20");
    expect(result.sizeMm).toBe(40);
    expect(result.sizeMm2).toBe(20);
  });

  it("prefers a labelled size over an incidental number", () => {
    expect(parseAttributes("PIPE, METALLIC;\nNOMINAL SIZE: DN500\nWALL THICKNESS: 9.5MM").sizeMm).toBe(500);
  });

  it("recovers a size the catalog glued to its unit", () => {
    expect(parseAttributes("CLAMP PIPE HEAVYDUTY16MMODPIPE-AL").sizeMm).toBe(16);
  });
});

describe("parseAttributes fitting attributes", () => {
  it("reads the schedule rating", () => {
    expect(parseAttributes("ELBOW SEAMLE BW:DN200:90DEG:SCH40:CS").schedule).toBe("SCH 40");
    expect(parseAttributes("PIPE MTLC;DN500,SCH40S,SS,316L,ERW").schedule).toBe("SCH 40S");
  });

  it("reads the bend angle", () => {
    expect(parseAttributes("ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS").angleDeg).toBe(90);
    expect(parseAttributes("ELBOW BW DN200SCH80CS45DEG").angleDeg).toBe(45);
  });

  it("reads the wall thickness from its own line", () => {
    expect(parseAttributes("PIPE, METALLIC;\nNOMINAL SIZE: DN500\nWALL THICKNESS: 9.5 MM").wallThicknessMm).toBe(9.5);
  });

  it("recovers a pressure the catalog glued to the following word", () => {
    expect(parseAttributes("FRL UNIT, MAKE : SMC, MAX PRESSURE : 10 BARAPPLICATION : PNEUMATIC").pressureClass).toBe("10 BAR");
  });

  it("reads a label whose spacing the catalog lost", () => {
    expect(parseAttributes("TUBE, METALLIC;\nMATERIALSPECIFICATION: ASTM-B75").standards).toContain("ASTM-B75");
  });
});

describe("parseAttributes subtype set", () => {
  // A description states several modifiers and which one is "the" subtype is arbitrary, so all of
  // them are kept and agreement is scored as overlap.
  it("collects every modifier the description states", () => {
    const result = parseAttributes("FLNG PIPE;SLP-ON,RSD FACE,DN40,CS,CL 150", "", ["SLIP ON", "RAISED", "BLIND"]);
    expect(result.subtypes).toContain("SLIP ON");
    expect(result.subtype).toBe(result.subtypes[0]);
  });

  it("reports an empty set rather than a wrong guess when nothing matches", () => {
    expect(parseAttributes("PIPE DN500", "", ["BUTTERFLY"]).subtypes).toEqual([]);
  });
});

describe("parseAttributes term matching", () => {
  // BSPP precedes BSP in the connection list and is within one edit of it, so a single pass that
  // allowed fuzzy matching per term reported "BSP" as "BSPP".
  it("prefers an exact term anywhere in the list over a fuzzy match earlier in it", () => {
    expect(parseAttributes("NPLE PIPE HEX;1/4IN,BSP,CS", "", undefined, true).connection).toBe("BSP");
  });

  it("recognizes a material written in the catalog's abbreviation", () => {
    expect(parseAttributes("FLNG PIPE;DN40,CS").materials).toContain("CARBON STEEL");
  });
});

describe("isBlockedStatus", () => {
  it("recognizes the procurement block so the row can be ranked last but stay searchable", () => {
    expect(isBlockedStatus("Blocked for Procurement")).toBe(true);
    expect(isBlockedStatus("Blocked For Procu StK>365")).toBe(true);
    expect(isBlockedStatus("")).toBe(false);
  });

  it("keeps a blocked material searchable", () => {
    expect(isActiveStatus("Blocked for Procurement")).toBe(true);
  });
});
