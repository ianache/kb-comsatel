export interface SqlExecutor {
  query<T>(sql: string, params: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params: readonly unknown[]): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
