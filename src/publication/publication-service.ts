import { PublicationError } from "./publication-errors.js";
import type { GitLabPort } from "./gitlab-port.js";
import { buildPublicationPlan } from "./publication-plan.js";
import type {
  PublicationPlan,
  PublicationRequest,
  PublicationResult,
} from "./publication-types.js";

export type ApprovedProjectionIndexer = (
  request: PublicationRequest,
) => Promise<void>;

export class PublicationService {
  constructor(
    private readonly gitlab: GitLabPort,
    private readonly indexApprovedProjection?: ApprovedProjectionIndexer,
  ) {}

  plan(request: PublicationRequest): PublicationPlan {
    return buildPublicationPlan(request);
  }

  async createProposal(
    request: PublicationRequest,
  ): Promise<PublicationResult> {
    if (request.mode !== "proposal") {
      throw new PublicationError(
        "PUBLICATION_INVALID_CORPUS",
        "Proposal creation requires proposal mode",
      );
    }
    const plan = this.plan(request);
    const baseBranch = await this.gitlab.getBranch(
      request.projectId,
      request.baseBranch,
    );
    if (baseBranch === null) {
      throw new PublicationError(
        "GITLAB_PROJECT_NOT_ALLOWED",
        "Base branch is unavailable",
      );
    }
    if (baseBranch.sha !== request.baseSha) {
      throw new PublicationError(
        "BASE_BRANCH_CHANGED",
        "Base branch changed; regenerate the proposal",
      );
    }

    const existingMergeRequest = await this.gitlab.findOpenMergeRequest({
      projectId: request.projectId,
      sourceBranch: plan.branchName,
      targetBranch: request.baseBranch,
      identityKey: plan.identityKey,
    });
    if (existingMergeRequest !== null) {
      const branch = await this.gitlab.getBranch(
        request.projectId,
        plan.branchName,
      );
      if (branch === null) {
        throw new PublicationError(
          "PUBLICATION_CONFLICT",
          "Open Merge Request branch is unavailable",
        );
      }
      return resultFromMergeRequest(plan, existingMergeRequest, branch.sha);
    }

    const existingBranch = await this.gitlab.getBranch(
      request.projectId,
      plan.branchName,
    );
    if (existingBranch !== null && existingBranch.sha !== request.baseSha) {
      throw new PublicationError(
        "PUBLICATION_CONFLICT",
        "Proposal branch contains different content",
      );
    }
    if (existingBranch === null) {
      await this.gitlab.createBranch({
        projectId: request.projectId,
        branch: plan.branchName,
        ref: request.baseSha,
      });
    }

    const latestBaseBranch = await this.gitlab.getBranch(
      request.projectId,
      request.baseBranch,
    );
    if (latestBaseBranch?.sha !== request.baseSha) {
      throw new PublicationError(
        "BASE_BRANCH_CHANGED",
        "Base branch changed before commit",
      );
    }
    const commit = await this.gitlab.createCommit({
      projectId: request.projectId,
      branch: plan.branchName,
      commitMessage: plan.commitMessage,
      files: plan.files,
    });
    const mergeRequest = await this.gitlab.createMergeRequest({
      projectId: request.projectId,
      sourceBranch: plan.branchName,
      targetBranch: request.baseBranch,
      title: plan.mergeRequestTitle,
      description: plan.mergeRequestDescription,
      labels: request.labels,
      reviewerIds: request.reviewerIds,
    });
    return resultFromMergeRequest(plan, mergeRequest, commit.id);
  }
}

function resultFromMergeRequest(
  plan: PublicationPlan,
  mergeRequest: Awaited<ReturnType<GitLabPort["createMergeRequest"]>>,
  commitSha: string,
): PublicationResult {
  return {
    branchName: mergeRequest.sourceBranch,
    commitSha,
    mergeRequestIid: mergeRequest.iid,
    mergeRequestUrl: mergeRequest.webUrl,
    mergeRequestState: mergeRequest.state,
    ciState: "unknown",
    fileCount: plan.files.length,
    mode: plan.mode,
    outcome: "proposal-created",
    corpusHash: plan.corpusHash,
  };
}
