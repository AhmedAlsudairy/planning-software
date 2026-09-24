import { describe, expect, it } from "vitest";
import { rankCandidates, shortlistCandidates } from "@/lib/matcher";
import { parseAttributes } from "@/lib/normalization";
import type { MaterialCandidate } from "@/types/material";

function candidate(id: string, description: string, className = "VALVE, BUTTERFLY", overrides: Partial<MaterialCandidate> = {}): MaterialCandidate {
  return {
    id,
    corporateNo: `M-${id}`,
    sapNo: `SAP-${id}`,
    plant: "8501",
    plants: ["8501"],
    className,
    materialGroup: "",
    materialGroupDescription: "",
    shortDescription: description,
    longDescription: description,
    uom: "EA",
    materialType: "ZSPR",
    unspsc: "",
    status: "B2-ERP ACCEPTED",
    statusDescription: "New Sap Code Created",
    itemTypeSource: "GENERIC",
    attributes: parseAttributes(description, className),
    statusActive: true,
    rawData: {},
    lexicalScore: 0.8,
    fuzzyScore: 0.8,
    exactMatch: false,
    embedding: null,
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("ranks exact engineering parameters above a semantic-looking size mismatch", () => {
    const query = parseAttributes("VALVE, BUTTERFLY, DN300, PN10, WAFER, EN593, BODY: CI, EPDM, FF:78MM");
    const exact = candidate("exact", "VALVE, BUTTERFLY; SIZE: 300 MM PRESSURE RATING: PN10 CONNECTION TYPE: WAFER BODY MATERIAL: CI SEAT MATERIAL: EPDM FACE-TO-FACE: 78 MM STANDARD: EN593");
    const wrongSize = candidate("wrong", "VALVE, BUTTERFLY; SIZE: 100 MM PRESSURE RATING: PN10 CONNECTION TYPE: WAFER BODY MATERIAL: CI SEAT MATERIAL: EPDM FACE-TO-FACE: 78 MM STANDARD: EN593");
    wrongSize.embedding = [1, 0];
    const matches = rankCandidates(query, [wrongSize, exact], [1, 0], 5);
    expect(matches[0].id).toBe("exact");
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
  });

  it("keeps the exact-size candidate in the shortlist ahead of wrong-size candidates", () => {
    const query = parseAttributes("VALVE, BUTTERFLY, DN300, PN10, WAFER, EN593, BODY: CI, EPDM, FF:78MM");
    const exactSize = candidate("dn300", "VALVE, BUTTERFLY; SIZE: DN300 PRESSURE RATING: PN6");
    const wrongSize = Array.from({ length: 12 }, (_, index) =>
      candidate(`dn100-${index}`, "VALVE, BUTTERFLY; SIZE: DN100 PRESSURE RATING: 10 BAR CONNECTION TYPE: WAFER BODY MATERIAL: SS"),
    );
    const shortlist = shortlistCandidates(query, [...wrongSize, exactSize], 8);
    expect(shortlist.map((entry) => entry.id)).toContain("dn300");
    expect(shortlist[0].id).toBe("dn300");
  });

  it("filters a repair kit from a generic valve query", () => {
    const query = parseAttributes("VALVE DN50");
    const kit = candidate("kit", "KIT, VALVE REPAIR; SIZE: 50 MM", "KIT, VALVE REPAIR");
    expect(rankCandidates(query, [kit], null, 5)).toHaveLength(0);
  });
});

describe("rankCandidates result ordering", () => {
  const query = () => parseAttributes("ELBOW DN200 90DEG SCH 40 CS");

  it("keeps a material from another family but ranks it below the right family", () => {
    const right = candidate("elbow", "ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS", "ELBOW");
    const wrong = candidate("flange", "FLNG PIPE;SLP-ON,DN200,CS", "FLANGE");
    const matches = rankCandidates(query(), [wrong, right], null, 5);
    // "Search for all": a cross-family row is still an answer, just never the preferred one.
    expect(matches.map((match) => match.id)).toEqual(["elbow", "flange"]);
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
  });

  it("treats a bend as the same family as an elbow", () => {
    const bend = candidate("bend", "BEND PIPE;200MM,90DEG,SCH 40,CS", "BEND");
    const flange = candidate("flange", "FLNG PIPE;SLP-ON,DN200,CS", "FLANGE");
    const matches = rankCandidates(query(), [flange, bend], null, 5);
    expect(matches[0].id).toBe("bend");
  });

  it("ranks blocked stock below available stock", () => {
    const available = candidate("available", "ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS", "ELBOW");
    const blocked = candidate("blocked", "ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS", "ELBOW", { status: "Blocked for Procurement" });
    const matches = rankCandidates(query(), [blocked, available], null, 5);
    expect(matches.map((match) => match.id)).toEqual(["available", "blocked"]);
    expect(matches[1].blocked).toBe(true);
  });

  it("puts an exact identification first even when it is blocked", () => {
    const similar = candidate("similar", "ELBW PIPE;200MM,90DEG,SCH 40,BUTT WLD,CS", "ELBOW");
    const exact = candidate("exact", "ELBOW SOMETHING ELSE", "ELBOW", { status: "Blocked for Procurement", exactMatch: true });
    const matches = rankCandidates(query(), [similar, exact], null, 5);
    expect(matches[0].id).toBe("exact");
    expect(matches[0].confidence).toBe(100);
  });

  it("reports every plant carrying the material on its single row", () => {
    const multi = candidate("multi", "ELBW PIPE;200MM,90DEG,SCH 40,CS", "ELBOW", { plants: ["7502", "8502", "8506"] });
    expect(rankCandidates(query(), [multi], null, 5)[0].plants).toEqual(["7502", "8502", "8506"]);
  });

  it("falls back to the single plant when no plant list was collected", () => {
    const single = candidate("single", "ELBW PIPE;200MM,90DEG,SCH 40,CS", "ELBOW", { plants: [] });
    expect(rankCandidates(query(), [single], null, 5)[0].plants).toEqual(["8501"]);
  });

  it("scores a size mismatch well below a size match", () => {
    const rightSize = candidate("dn200", "ELBW PIPE;200MM,90DEG,SCH 40,CS", "ELBOW");
    const wrongSize = candidate("dn50", "ELBW PIPE;50MM,90DEG,SCH 40,CS", "ELBOW");
    const matches = rankCandidates(query(), [wrongSize, rightSize], null, 5);
    expect(matches[0].id).toBe("dn200");
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence * 1.3);
  });
});
