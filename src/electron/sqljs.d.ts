declare module "sql.js" {
  export type SqlValue = string | number | Uint8Array | null;
  export type BindParams = SqlValue[] | Record<string, SqlValue>;

  export interface Statement {
    bind(values?: BindParams): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    free(): void;
  }

  export class Database {
    constructor(data?: Uint8Array);
    run(sql: string, params?: BindParams): Database;
    exec(sql: string): unknown[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
