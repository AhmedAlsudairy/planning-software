import { describe, expect, it } from "vitest";
import { compact, editDistance, extractModelQuery, matchModel } from "@/lib/partnumber";

describe("compact", () => {
  it("makes the catalog's different spellings of one designation identical", () => {
    const spellings = ["NU 2232 ECMA/C3", "NU2232ECMA/C3", "NU-2232-ECMA-C3"];
    expect(new Set(spellings.map(compact))).toEqual(new Set(["NU2232ECMAC3"]));
  });
});

describe("editDistance", () => {
  it("counts an adjacent transposition as one slip", () => {
    expect(editDistance("2322", "2232")).toBe(1);
    expect(editDistance("NU2322ECMAC3", "NU2232ECMAC3")).toBe(1);
  });
});

describe("extractModelQuery", () => {
  it("reads a designation typed with spaces and a slash", () => {
    expect(extractModelQuery("NU2322 ECMA C3")?.primary).toBe("NU2322ECMAC3");
    expect(extractModelQuery("NU 2232 ECMA/C3")?.primary).toBe("NU2232ECMAC3");
  });

  it("ignores the descriptive words around it", () => {
    expect(extractModelQuery("roller bearing NU2232 ECMA C3 for motor")?.primary).toBe("NU2232ECMAC3");
  });

  it("offers each piece on its own so a partly-matching row is still found", () => {
    const model = extractModelQuery("NU2322 ECMA C3");
    expect(model?.spans).toContain("ECMAC3");
    expect(model?.spans).toContain("NU2322");
  });

  it("finds a bearing number with a maker prefix or suffix", () => {
    expect(extractModelQuery("SKF 6205 2RS")?.primary).toBe("SKF62052RS");
  });

  it("does not treat a sized description as a part number", () => {
    expect(extractModelQuery("slip on flange raised face DN40 carbon steel class 150")).toBeNull();
    expect(extractModelQuery("reducing tee 40 x 20 3000# threaded")).toBeNull();
    expect(extractModelQuery("copper tube 1/4 inch PN10")).toBeNull();
  });

  it("does not treat a short code as a part number", () => {
    expect(extractModelQuery("M12 bolt")).toBeNull();
  });
});

describe("matchModel", () => {
  const query = extractModelQuery("NU2232 ECMA C3")!;

  it("is exact wherever the catalog put its separators", () => {
    expect(matchModel(query, compact("BRG RLLR;PN:NU 2232 ECMA/C3;160MM,290MM")).kind).toBe("exact");
    expect(matchModel(query, compact("BRG RLLR;PN:NU-2232-ECMA-C3;160MM")).kind).toBe("exact");
  });

  // 2322 for 2232 is the mistake that started this: a bearing that differs by one digit is a
  // different bearing, so it is reported as close, never as a match.
  it("reports a transposed digit as close rather than exact", () => {
    const typo = extractModelQuery("NU2322 ECMA C3")!;
    const match = matchModel(typo, compact("BRG RLLR;PN:NU 2232 ECMA/C3;160MM,290MM"));
    expect(match.kind).toBe("close");
    expect(match.score).toBeLessThan(0.85);
    expect(match.found).toBe("NU2232ECMAC3");
  });

  it("does not confuse two different bearing variants", () => {
    expect(matchModel(query, compact("BRG RLLR;PN:NU 2232 ECML/C3;160MM")).kind).not.toBe("exact");
  });

  it("finds nothing in an unrelated row", () => {
    expect(matchModel(query, compact("ELBW PIPE;200MM,90DEG,SCH 40,CS")).kind).toBe("none");
  });
});
