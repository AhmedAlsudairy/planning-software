import { describe, expect, it } from "vitest";
import { rankCandidates, shortlistCandidates } from "@/lib/matcher";
import { parseAttributes } from "@/lib/normalization";
import type { MaterialCandidate } from "@/types/material";

function candidate(id: string, description: string, className = "VALVE, BUTTERFLY"): MaterialCandidate {
  return {
    id,
    corporateNo: `M-${id}`,
    sapNo: `SAP-${id}`,
    plant: "8501",
    className,
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
    embedding: null,
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
