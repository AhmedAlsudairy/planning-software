import { describe, expect, it } from "vitest";
import { areRelatedItemTypes, buildSearchText, deriveItemType, deriveSubtypeVocabulary, expandAbbreviations, unescapeSapText } from "@/lib/vocabulary";

describe("expandAbbreviations", () => {
  it("rewrites the SAP short-text dialect into plain English", () => {
    expect(expandAbbreviations("FLNG PIPE;SLP-ON,RSD FACE,DN40,CS,CL 150")).toBe("FLANGE PIPE;SLIP-ON,RAISED FACE,DN40,CARBON STEEL,CL 150");
    expect(expandAbbreviations("ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS")).toContain("ELBOW");
  });

  it("leaves words that are not abbreviations alone", () => {
    expect(expandAbbreviations("COPPER TUBE 6MM")).toBe("COPPER TUBE 6MM");
  });
});

describe("unescapeSapText", () => {
  it("removes the SAP escape markers around characters it cannot store", () => {
    expect(unescapeSapText("CLAMP,PIPE,PP,3\",HD,TOP<(>&<)>BOTTOM PLATE")).toBe("CLAMP,PIPE,PP,3\",HD,TOP&BOTTOM PLATE");
  });
});

describe("buildSearchText", () => {
  it("indexes the abbreviation and its expansion so either spelling retrieves the row", () => {
    const text = buildSearchText("FLNG PIPE;SLP-ON,RSD FACE,DN40");
    expect(text).toContain("FLNG");
    expect(text).toContain("FLANGE");
  });

  it("does not repeat a token that needs no expansion", () => {
    const tokens = buildSearchText("COPPER TUBE").split(" ");
    expect(tokens).toEqual([...new Set(tokens)]);
  });
});

describe("deriveItemType", () => {
  // The generic trailing noun is what most SAP short texts end with, so specificity has to beat
  // position here - otherwise almost the whole catalog resolves to PIPE.
  it("prefers the specific component over the generic form beside it", () => {
    expect(deriveItemType("ELBW PIPE;200MM,90DEG")).toBe("ELBOW");
    expect(deriveItemType("CLAMP PIPE HEAVYDUTY16MMODPIPE-AL")).toBe("CLAMP");
    expect(deriveItemType("ADPTR TUBE TO PIPE;1/4IN,MBSPP,BRS")).toBe("ADAPTOR");
  });

  it("keeps the generic form when that is all the description states", () => {
    expect(deriveItemType("PIPE MTLC;DN500,SCH40S,SS,316L,ERW")).toBe("PIPE");
  });

  it("uses the head noun when two specific types are both present", () => {
    expect(deriveItemType("TEE PIPE REDCR;40X20")).toBe("TEE");
  });

  it("falls back to the class column and then the long text", () => {
    expect(deriveItemType("", "", "VALVE, BUTTERFLY")).toBe("VALVE");
    expect(deriveItemType("", "GASKET, SPIRAL WOUND; DN50")).toBe("GASKET");
  });

  it("returns null when nothing in the description names a known family", () => {
    expect(deriveItemType("XYZ123 MISC STOCK")).toBeNull();
  });
});

describe("areRelatedItemTypes", () => {
  it("treats the same part under two catalog names as one family", () => {
    expect(areRelatedItemTypes("ELBOW", "BEND")).toBe(true);
    expect(areRelatedItemTypes("ADAPTOR", "CONNECTOR")).toBe(true);
  });

  it("keeps unrelated families apart", () => {
    expect(areRelatedItemTypes("FLANGE", "ELBOW")).toBe(false);
  });

  it("is permissive when either side is unknown, so an unrecognized query is not filtered away", () => {
    expect(areRelatedItemTypes(null, "ELBOW")).toBe(true);
    expect(areRelatedItemTypes("ELBOW", null)).toBe(true);
  });
});

describe("deriveSubtypeVocabulary", () => {
  const corpus = (term: string, count: number) => Array.from({ length: count }, () => `ELBW PIPE ${term}`);

  it("mines modifiers from the descriptions rather than the class column", () => {
    expect(deriveSubtypeVocabulary(corpus("CONCENTRIC", 10))).toContain("CONCENTRIC");
  });

  it("rejects glued fragments produced by the catalog's lost line breaks", () => {
    expect(deriveSubtypeVocabulary(corpus("BUTTWELDCSMATERIAL", 10))).not.toContain("BUTTWELDCSMATERIAL");
  });

  it("rejects words already scored as a material or a connection", () => {
    const terms = deriveSubtypeVocabulary([...corpus("STAINLESS", 10), ...corpus("THREADED", 10)]);
    expect(terms).not.toContain("STAINLESS");
    expect(terms).not.toContain("THREADED");
  });

  it("rejects a term too rare to be vocabulary and one too common to discriminate", () => {
    const terms = deriveSubtypeVocabulary([...corpus("RAREWORD", 2), ...corpus("UBIQUITOUS", 98)]);
    expect(terms).not.toContain("RAREWORD");
    expect(terms).not.toContain("UBIQUITOUS");
  });

  it("always includes the seed vocabulary so a query works before the first import", () => {
    expect(deriveSubtypeVocabulary([])).toContain("BUTTERFLY");
  });
});
