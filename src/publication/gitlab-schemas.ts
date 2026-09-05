import { z } from "zod";

export const gitlabBranchSchema = z.object({
  name: z.string().min(1),
  commit: z.object({ id: z.string().min(1) }).strict(),
});

export const gitlabCommitSchema = z.object({
  id: z.string().min(1),
  web_url: z.string().url(),
});

export const gitlabMergeRequestSchema = z.object({
  iid: z.number().int().positive(),
  web_url: z.string().url(),
  source_branch: z.string().min(1),
  target_branch: z.string().min(1),
  state: z.enum(["opened", "merged", "closed"]),
  description: z.string(),
});

export type GitLabBranchResponse = z.infer<typeof gitlabBranchSchema>;
export type GitLabCommitResponse = z.infer<typeof gitlabCommitSchema>;
export type GitLabMergeRequestResponse = z.infer<
  typeof gitlabMergeRequestSchema
>;
