import type { GovernanceIssue } from "./okf-types.js";
import type { OkfDocument } from "./okf-schema.js";

export function validateGovernance(
  document: OkfDocument,
  corpusIds: ReadonlySet<string>,
): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  const issue = (code: string, field: string, message: string) => {
    issues.push({ code, file: document.file, field, message });
  };

  if (document.status === "stable") {
    if (document.owner.trim().length === 0) {
      issue(
        "STABLE_OWNER_REQUIRED",
        "owner",
        "stable documents require an owner",
      );
    }
    if (document.evidence.length === 0) {
      issue(
        "STABLE_EVIDENCE_REQUIRED",
        "evidence",
        "stable documents require evidence",
      );
    }
    if (document.verifiedAt === undefined) {
      issue(
        "STABLE_VERIFICATION_REQUIRED",
        "verifiedAt",
        "stable documents require verification",
      );
    }
    if (!hasAcl(document)) {
      issue("STABLE_ACL_REQUIRED", "acl", "stable documents require an ACL");
    }
  }

  if (
    document.staleAfter !== undefined &&
    document.verifiedAt !== undefined &&
    Date.parse(document.staleAfter) < Date.parse(document.verifiedAt)
  ) {
    issue(
      "STALE_AFTER_BEFORE_VERIFICATION",
      "staleAfter",
      "staleAfter cannot precede verifiedAt",
    );
  }

  const successor = document.relations.supersededBy;
  if (document.status === "superseded" && successor === undefined) {
    issue(
      "SUPERSEDED_SUCCESSOR_REQUIRED",
      "relations.supersededBy",
      "superseded documents require a successor",
    );
  }
  for (const relation of [successor, ...(document.relations.relatedTo ?? [])]) {
    if (relation === undefined) continue;
    if (relation === document.knowledgeId) {
      issue(
        "RELATION_SELF_REFERENCE",
        "relations",
        "a document cannot relate to itself",
      );
    } else if (!corpusIds.has(relation)) {
      issue(
        "RELATION_TARGET_NOT_FOUND",
        "relations",
        "relation target does not exist in the corpus",
      );
    }
  }

  return issues;
}

function hasAcl(document: OkfDocument): boolean {
  return Object.values(document.acl).some((values) => values.length > 0);
}
