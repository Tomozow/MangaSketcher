import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

const require = createRequire(import.meta.url);

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const wasmFile = require.resolve('sql.js/dist/sql-wasm.wasm');
    const wasmDir = dirname(wasmFile);
    sqlJsPromise = initSqlJs({
      locateFile: (file) => join(wasmDir, file),
    });
  }
  return sqlJsPromise;
}

export async function openDatabase(bytes: Uint8Array): Promise<Database> {
  const SQL = await getSqlJs();
  return new SQL.Database(bytes);
}

export function exportDatabase(db: Database): Uint8Array {
  return db.export();
}
