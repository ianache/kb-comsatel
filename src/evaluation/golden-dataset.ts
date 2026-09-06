import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  goldenCaseSchema,
  type GoldenEvaluationDataset,
} from "./golden-types.js";

export const goldenDatasetSchema = z
  .object({
    version: z.number().int().positive(),
    cases: z.array(goldenCaseSchema).length(30),
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    for (const [index, item] of dataset.cases.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate golden case id: ${item.id}`,
        });
      }
      ids.add(item.id);
    }
  });

export type { GoldenEvaluationDataset } from "./golden-types.js";

export async function loadGoldenDataset(
  path: string,
): Promise<GoldenEvaluationDataset> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return goldenDatasetSchema.parse(parsed);
}

export { goldenCaseSchema } from "./golden-types.js";
