import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { MaterialAttributes, MaterialCandidate } from "@/types/material";
import { saveEmbedding } from "@/lib/db";

const extractionSchema = {
  type: "object",
  properties: {
    itemType: { type: ["string", "null"] },
    subtype: { type: ["string", "null"] },
    sizeMm: { type: ["number", "null"] },
    sizeDisplay: { type: ["string", "null"] },
    pressureBar: { type: ["number", "null"] },
    pressureClass: { type: ["string", "null"] },
    connection: { type: ["string", "null"] },
    faceToFaceMm: { type: ["number", "null"] },
    bodyMaterial: { type: ["string", "null"] },
    discMaterial: { type: ["string", "null"] },
    stemMaterial: { type: ["string", "null"] },
    seatMaterial: { type: ["string", "null"] },
    materials: { type: "array", items: { type: "string" } },
    standards: { type: "array", items: { type: "string" } },
    actuation: { type: ["string", "null"] },
  },
  required: ["itemType", "subtype", "sizeMm", "sizeDisplay", "pressureBar", "pressureClass", "connection", "faceToFaceMm", "bodyMaterial", "discMaterial", "stemMaterial", "seatMaterial", "materials", "standards", "actuation"],
  additionalProperties: false,
};

const extractedAttributesSchema = z.object({
  itemType: z.string().nullable(),
  subtype: z.string().nullable(),
  sizeMm: z.number().nullable(),
  sizeDisplay: z.string().nullable(),
  pressureBar: z.number().nullable(),
  pressureClass: z.string().nullable(),
  connection: z.string().nullable(),
  faceToFaceMm: z.number().nullable(),
  bodyMaterial: z.string().nullable(),
  discMaterial: z.string().nullable(),
  stemMaterial: z.string().nullable(),
  seatMaterial: z.string().nullable(),
  materials: z.array(z.string()),
  standards: z.array(z.string()),
  actuation: z.string().nullable(),
});

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 8_000, retryOptions: { attempts: 1 } } });
}

function clean(value: string | null): string | null {
  return value?.trim().toUpperCase() || null;
}

export async function extractQueryAttributes(query: string, deterministic: MaterialAttributes): Promise<MaterialAttributes> {
  const response = await client().interactions.create({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    input: `Extract only engineering attributes explicitly present in this material specification. Convert inch sizes to millimetres. Do not infer missing values or claim pressure-class equivalence. Specification: ${query}`,
    response_format: { type: "text", mime_type: "application/json", schema: extractionSchema },
    store: false,
  }, { timeout: 8_000, maxRetries: 0 });
  if (!("output_text" in response) || !response.output_text) return deterministic;
  const extracted = extractedAttributesSchema.parse(JSON.parse(response.output_text));
  return {
    itemType: deterministic.itemType || clean(extracted.itemType),
    subtype: deterministic.subtype || clean(extracted.subtype),
    sizeMm: deterministic.sizeMm ?? extracted.sizeMm,
    sizeDisplay: deterministic.sizeDisplay || clean(extracted.sizeDisplay),
    pressureBar: deterministic.pressureBar ?? extracted.pressureBar,
    pressureClass: deterministic.pressureClass || clean(extracted.pressureClass),
    connection: deterministic.connection || clean(extracted.connection),
    faceToFaceMm: deterministic.faceToFaceMm ?? extracted.faceToFaceMm,
    bodyMaterial: deterministic.bodyMaterial || clean(extracted.bodyMaterial),
    discMaterial: deterministic.discMaterial || clean(extracted.discMaterial),
    stemMaterial: deterministic.stemMaterial || clean(extracted.stemMaterial),
    seatMaterial: deterministic.seatMaterial || clean(extracted.seatMaterial),
    materials: [...new Set([...deterministic.materials, ...extracted.materials.map((item) => item.toUpperCase())])],
    standards: [...new Set([...deterministic.standards, ...extracted.standards.map((item) => item.toUpperCase())])],
    actuation: deterministic.actuation || clean(extracted.actuation),
  };
}

async function embed(text: string): Promise<number[]> {
  const response = await client().models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    contents: text,
    config: { outputDimensionality: 768, httpOptions: { timeout: 8_000, retryOptions: { attempts: 1 } } },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values?.length) throw new Error("Gemini returned an empty embedding");
  return values;
}

export function embedSearchQuery(query: string): Promise<number[]> {
  return embed(`task: search result | query: ${query}`);
}

function candidateDocument(candidate: MaterialCandidate): string {
  return `title: ${candidate.shortDescription || candidate.className} | text: ${candidate.className}; ${candidate.longDescription}`;
}

export async function hydrateCandidateEmbeddings(candidates: MaterialCandidate[]): Promise<void> {
  const missing = candidates.filter((candidate) => !candidate.embedding);
  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = missing.slice(offset, offset + 8);
    await Promise.all(batch.map(async (candidate) => {
      const embedding = await embed(candidateDocument(candidate));
      candidate.embedding = embedding;
      await saveEmbedding(candidate.id, embedding);
    }));
  }
}
