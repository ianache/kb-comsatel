import { describe, expect, it, vi } from "vitest";
import { compileOkfCorpus } from "../../src/okf/compiler.js";
import { FakeGitLabAdapter } from "../../src/publication/fake-gitlab-adapter.js";
import { PublicationService } from "../../src/publication/publication-service.js";
import type { PublicationRequest } from "../../src/publication/publication-types.js";

async function requestFromFixture(): Promise<PublicationRequest> {
  return {
    projectId: "project-1",
    baseBranch: "main",
    baseSha: "base-sha-1",
    branchPrefix: "knowledge/proposal",
    corpus: await compileOkfCorpus("tests/fixtures/okf-valid", {
      mode: "stable",
    }),
    title: "Publish OKF rule",
    description: "Propose a curated rule",
    labels: ["knowledge", "okf"],
    reviewerIds: ["reviewer-1"],
    mode: "proposal",
    correlationId: "corr-1",
  };
}

describe("PublicationService proposals", () => {
  it("creates a branch, commit and Merge Request", async () => {
    const adapter = new FakeGitLabAdapter();
    const result = await new PublicationService(adapter).createProposal(
      await requestFromFixture(),
    );

    expect(result).toMatchObject({
      branchName: expect.stringMatching(/^knowledge\/proposal\//u),
      mergeRequestIid: 1,
      mergeRequestState: "opened",
      outcome: "proposal-created",
      fileCount: 1,
    });
    expect(result.mergeRequestUrl).toContain("merge_requests/1");
  });

  it("reuses an equivalent open Merge Request", async () => {
    const adapter = new FakeGitLabAdapter();
    const service = new PublicationService(adapter);
    const request = await requestFromFixture();
    const first = await service.createProposal(request);
    const callsBeforeSecond = adapter.calls.length;
    const second = await service.createProposal(request);

    expect(second.mergeRequestIid).toBe(first.mergeRequestIid);
    expect(adapter.calls.length).toBe(callsBeforeSecond + 3);
    expect(
      adapter.calls.filter((call) => call.startsWith("createMr")).length,
    ).toBe(1);
  });

  it("rejects an invalid corpus before calling GitLab", async () => {
    const adapter = new FakeGitLabAdapter();
    const request = await requestFromFixture();
    const invalid = {
      ...request,
      corpus: { ...request.corpus, errors: [{ code: "INVALID" }] },
    } as PublicationRequest;

    await expect(
      new PublicationService(adapter).createProposal(invalid),
    ).rejects.toMatchObject({
      code: "PUBLICATION_INVALID_CORPUS",
    });
    expect(adapter.calls).toEqual([]);
  });

  it("rejects a proposal branch with different content", async () => {
    const adapter = new FakeGitLabAdapter();
    const request = await requestFromFixture();
    adapter.seedBranch(
      "project-1",
      `knowledge/proposal/${request.corpus.manifest.corpusHash}`,
      "other-sha",
    );

    await expect(
      new PublicationService(adapter).createProposal(request),
    ).rejects.toMatchObject({
      code: "PUBLICATION_CONFLICT",
    });
  });

  it("rejects a changed base branch", async () => {
    const adapter = new FakeGitLabAdapter();
    adapter.setBranchSha("project-1", "main", "new-base-sha");

    await expect(
      new PublicationService(adapter).createProposal(
        await requestFromFixture(),
      ),
    ).rejects.toMatchObject({
      code: "BASE_BRANCH_CHANGED",
    });
  });

  it("does not expose corpus content in its result", async () => {
    const adapter = new FakeGitLabAdapter();
    const result = await new PublicationService(adapter).createProposal(
      await requestFromFixture(),
    );

    expect(JSON.stringify(result)).not.toContain("Verified unit identifiers");
  });

  it("requires approval before stable publication", async () => {
    const adapter = new FakeGitLabAdapter();
    const indexApprovedProjection = vi.fn(async () => undefined);
    const service = new PublicationService(adapter, indexApprovedProjection);
    const proposal = await service.createProposal(await requestFromFixture());

    await expect(
      service.publishApproved({
        ...(await requestFromFixture()),
        mode: "approved-publish",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(indexApprovedProjection).not.toHaveBeenCalled();
    expect(proposal.mergeRequestIid).toBe(1);
  });

  it("indexes only after approval and green CI", async () => {
    const adapter = new FakeGitLabAdapter();
    const indexApprovedProjection = vi.fn(async () => undefined);
    const service = new PublicationService(adapter, indexApprovedProjection);
    const request = await requestFromFixture();
    const proposal = await service.createProposal(request);
    adapter.setGate(proposal.mergeRequestIid, {
      approved: true,
      ci: "success",
    });

    const result = await service.publishApproved({
      ...request,
      mode: "approved-publish",
    });

    expect(result).toMatchObject({
      mergeRequestIid: proposal.mergeRequestIid,
      mode: "approved-publish",
      outcome: "stable-publish-authorized",
      ciState: "success",
    });
    expect(indexApprovedProjection).toHaveBeenCalledOnce();
  });

  it("blocks stable publication when CI is not green", async () => {
    const adapter = new FakeGitLabAdapter();
    const service = new PublicationService(adapter, async () => undefined);
    const request = await requestFromFixture();
    const proposal = await service.createProposal(request);
    adapter.setGate(proposal.mergeRequestIid, {
      approved: true,
      ci: "running",
    });

    await expect(
      service.publishApproved({ ...request, mode: "approved-publish" }),
    ).rejects.toMatchObject({ code: "CI_NOT_GREEN" });
  });
});
