import { expect, it } from "vitest";
import { createMySqlPool } from "../../src/catalog/mysql-pool.js";

it("rejects a missing URL before opening a MySQL pool", () => {
  expect(() => createMySqlPool({ url: undefined, poolSize: 10 })).toThrow(
    "MySQL URL is required",
  );
});

it("exposes the SQL executor lifecycle around a configured pool", () => {
  const executor = createMySqlPool({
    url: "mysql://user:password@127.0.0.1:3306/kcp",
    poolSize: 3,
  });
  expect(executor.query).toBeTypeOf("function");
  expect(executor.execute).toBeTypeOf("function");
  expect(executor.ping).toBeTypeOf("function");
  expect(executor.close).toBeTypeOf("function");
  void executor.close();
});
