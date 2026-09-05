import { expect, it } from "vitest";
import { migrationSql } from "../../src/catalog/migrations.js";

it("contains the required I2 tables and foreign keys", () => {
  const sql = migrationSql.join("\n");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_artifacts");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_revisions");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_excerpts");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_acl");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_taxonomies");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS knowledge_audit_events");
  expect(sql).toMatch(/FOREIGN KEY.*knowledge_id/is);
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
});
