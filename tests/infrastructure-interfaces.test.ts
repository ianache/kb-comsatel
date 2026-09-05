import { expectTypeOf, it } from "vitest";
import type { SqlExecutor } from "../src/catalog/sql-executor.js";
import type { PrincipalResolver } from "../src/security/principal-resolver.js";

it("exposes dependency-injection interfaces without concrete infrastructure", () => {
  expectTypeOf<SqlExecutor["query"]>().toBeFunction();
  expectTypeOf<SqlExecutor["execute"]>().toBeFunction();
  expectTypeOf<SqlExecutor["ping"]>().toBeFunction();
  expectTypeOf<SqlExecutor["close"]>().toBeFunction();
  expectTypeOf<PrincipalResolver["resolve"]>().toBeFunction();
});
