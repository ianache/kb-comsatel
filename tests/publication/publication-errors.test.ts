import { expect, it } from "vitest";
import {
  PublicationError,
  publicationErrorCodes,
} from "../../src/publication/publication-errors.js";

it("exposes only bounded publication error codes", () => {
  const error = new PublicationError(
    "GITLAB_UNAVAILABLE",
    "GitLab is unavailable",
  );

  expect(publicationErrorCodes).toContain("GITLAB_UNAVAILABLE");
  expect(error.code).toBe("GITLAB_UNAVAILABLE");
  expect(error.message).toBe("GitLab is unavailable");
});
