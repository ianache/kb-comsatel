import { z } from "zod";

const identifier = z.string().trim().min(1);
const timestamp = z.string().datetime();

const aclSchema = z
  .object({
    principalIds: z.array(identifier).default([]),
    roles: z.array(identifier).default([]),
    groups: z.array(identifier).default([]),
    products: z.array(identifier).default([]),
    domains: z.array(identifier).default([]),
    classifications: z.array(identifier).default([]),
  })
  .strict();

const locatorSchema = z
  .object({
    sectionPath: identifier.optional(),
    pageRange: identifier.optional(),
    lineRange: identifier.optional(),
  })
  .strict()
  .default({});

const relationsSchema = z
  .object({
    supersededBy: identifier.optional(),
    relatedTo: z.array(identifier).default([]),
  })
  .strict()
  .default({ relatedTo: [] });

export const okfDocumentSchema = z
  .object({
    file: identifier,
    knowledgeId: identifier,
    title: identifier,
    artifactType: identifier,
    sourceUri: z.string().url(),
    sourceRevision: identifier,
    product: identifier,
    domain: identifier,
    classification: identifier,
    status: z.enum([
      "stable",
      "draft",
      "stale",
      "deprecated",
      "superseded",
      "archived",
    ]),
    owner: z.string(),
    evidence: z.array(z.string()),
    verifiedAt: timestamp.optional(),
    staleAfter: timestamp.optional(),
    locator: locatorSchema,
    acl: aclSchema,
    relations: relationsSchema,
    content: z.string(),
  })
  .strict();

export type OkfDocument = z.infer<typeof okfDocumentSchema>;
