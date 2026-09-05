import { createPool, type Pool } from "mysql2/promise";
import type { SqlExecutor } from "./sql-executor.js";

export interface MySqlPoolOptions {
  url: string | undefined;
  poolSize: number;
}

export function createMySqlPool({
  url,
  poolSize,
}: MySqlPoolOptions): SqlExecutor {
  if (!url) throw new Error("MySQL URL is required");

  const pool: Pool = createPool({
    uri: url,
    connectionLimit: poolSize,
    timezone: "Z",
    multipleStatements: true,
  });
  let closed = false;

  return {
    async query<T>(sql: string, params: readonly unknown[]) {
      const [rows] = await pool.query(sql, [...params]);
      return rows as T[];
    },
    async execute(sql: string, params: readonly unknown[]) {
      await pool.query(sql, [...params]);
    },
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
