import type { BridgeResults } from "../api.js";
import type { BridgeFault, InputParameters } from "./types.js";

type SQLiteInput = string | number | null;
type SQLiteOutput = SQLiteInput | bigint | Uint8Array;
interface SQLiteStatement {
  run(...values: SQLiteInput[]): unknown;
  iterate(
    ...values: (SQLiteInput | Record<string, SQLiteInput>)[]
  ): IterableIterator<SQLiteOutput[]>;
  columns(): { name: string }[];
  setReadBigInts(enabled: boolean): void;
  setReturnArrays(enabled: boolean): void;
  close?: () => void;
}
interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): void;
  close(): void;
  setAuthorizer?: (
    callback: (action: number, one: string | null, two: string | null) => number
  ) => void;
}
type SQLiteConstructor = new (
  location: string,
  options: { allowExtension: boolean; enableDoubleQuotedStringLiterals: boolean }
) => SQLiteDatabase;
export type SQLResult = Omit<BridgeResults["sql"], "capturedAt">;

import { assertSQLiteCapabilities } from "./sqlite-capabilities.js";

// SQLite is injected by the host. This module opens only an ephemeral :memory:
// database and never imports fs, opens a vault file, or registers an SQL function.
// Execute in a host-owned child process for a hard timeout: a worker thread
// cannot promptly interrupt a synchronous native SQLite call. Row limits do
// not bound query runtime.
const LIMITS = Object.freeze({
  sqlChars: 8192,
  rows: 200,
  defaultRows: 50,
  cellChars: 4096,
  snapshotBytes: 32 * 1024 * 1024,
  parameters: 128,
});
const SCHEMA = Object.freeze({
  notes: Object.freeze({
    path: "TEXT",
    title: "TEXT",
    folder: "TEXT",
    revision: "TEXT",
    source: "TEXT",
    content: "TEXT",
    modified: "REAL",
  }),
  headings: Object.freeze({
    path: "TEXT",
    heading: "TEXT",
    level: "INTEGER",
    line: "INTEGER",
    start: "INTEGER",
    end: "INTEGER",
  }),
  links: Object.freeze({
    source: "TEXT",
    target: "TEXT",
    resolved: "INTEGER",
    heading: "TEXT",
    line: "INTEGER",
  }),
  tags: Object.freeze({ path: "TEXT", tag: "TEXT" }),
  properties: Object.freeze({ path: "TEXT", key: "TEXT", value_json: "TEXT" }),
});
const forbidden = new Set([
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "LOAD_EXTENSION",
  "READFILE",
  "WRITEFILE",
  "EDIT",
  "EVAL",
  "RANDOMBLOB",
  "ZEROBLOB",
  "FTS3_TOKENIZER",
]);

function fail(code: string, message: string): never {
  const error = Object.assign(new Error(message), { code });
  throw error;
}

// Lexical boundary check, not a replacement SQL parser. SQLite validates syntax
// and query_only independently rejects mutations, including those after WITH.
// Semicolons inside strings, quoted identifiers and comments are not separators.
function validateSQL(sql: unknown): string {
  if (typeof sql !== "string" || !sql.trim() || sql.length > LIMITS.sqlChars || sql.includes("\0"))
    fail("INVALID_SQL", `SQL must contain 1–${LIMITS.sqlChars} characters without NUL.`);
  let first = null,
    ended = false;
  for (let i = 0; i < sql.length;) {
    const ch = sql[i]!,
      next = sql[i + 1];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      if (close < 0) fail("INVALID_SQL", "Unterminated SQL comment.");
      i = close + 2;
      continue;
    }
    if (ended) fail("READ_ONLY_SQL", "Only one SELECT or WITH statement is allowed.");
    if (ch === ";") {
      ended = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const quote = ch === "[" ? "]" : ch;
      const begin = i;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (quote !== "]" && sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) fail("INVALID_SQL", "Unterminated SQL quote.");
      if (ch !== "'") {
        const identifier = sql
          .slice(begin + 1, i - 1)
          .replaceAll(quote + quote, quote)
          .toUpperCase();
        if (
          forbidden.has(identifier) ||
          identifier.startsWith("PRAGMA_") ||
          identifier.startsWith("SQLITE_")
        )
          fail("READ_ONLY_SQL", "This identifier is not available in the read-only snapshot.");
      }
      continue;
    }
    if (ch === "?" || ch === ":" || ch === "@" || ch === "$") {
      i++;
      while (i < sql.length && /[\w$]/.test(sql[i]!)) i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const begin = i++;
      while (i < sql.length && /[\w$]/.test(sql[i]!)) i++;
      const token = sql.slice(begin, i).toUpperCase();
      if (!first) first = token;
      if (forbidden.has(token) || token.startsWith("PRAGMA_") || token.startsWith("SQLITE_"))
        fail("READ_ONLY_SQL", `SQL token ${token} is not available in the read-only snapshot.`);
      continue;
    }
    i++;
  }
  if (first !== "SELECT" && first !== "WITH")
    fail("READ_ONLY_SQL", "Only SELECT or WITH queries are allowed.");
  return sql;
}

function normalizeParameters(params: unknown): SQLiteInput[] | Record<string, SQLiteInput> {
  if (params == null) return [];
  if (
    !Array.isArray(params) &&
    (typeof params !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(params)))
  )
    fail("INVALID_PARAMS", "params must be an array or a plain named-parameter object.");
  const entries = Array.isArray(params) ? params : Object.values(params);
  if (entries.length > LIMITS.parameters)
    fail("INVALID_PARAMS", `At most ${LIMITS.parameters} parameters are allowed.`);
  const scalar = (value: unknown): SQLiteInput => {
    if (value === null) return null;
    if (typeof value === "boolean") return Number(value);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.length <= LIMITS.sqlChars) return value;
    fail(
      "INVALID_PARAMS",
      "Parameters must be finite numbers, strings of at most 8192 characters, booleans, or null."
    );
  };
  if (Array.isArray(params)) return params.map(scalar);
  const named: Record<string, SQLiteInput> = Object.create(null);
  for (const [key, value] of Object.entries(params)) {
    if (!/^[:@$]?[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      fail("INVALID_PARAMS", "Invalid named parameter key.");
    named[key] = scalar(value);
  }
  return named;
}

function normalizeSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_SNAPSHOT", "A snapshot object is required.");
  const snapshot = value as Record<string, unknown>;
  let bytes = 0;
  const normalized: Record<string, SQLiteInput[][]> = {},
    counts: Record<string, number> = {};
  for (const [table, schema] of Object.entries(SCHEMA)) {
    const records = snapshot[table] == null ? [] : snapshot[table];
    if (!Array.isArray(records)) fail("INVALID_SNAPSHOT", `${table} must be an array.`);
    counts[table] = records.length;
    normalized[table] = records.map((value: unknown) => {
      const record = value as Record<string, unknown> | null;
      if (!record || typeof record !== "object" || Array.isArray(record))
        fail("INVALID_SNAPSHOT", `Invalid ${table} row.`);
      // Count even empty rows toward the snapshot bound.
      bytes += 64;
      const row = Object.entries(schema).map(([key, type]) => {
        const value = record[key];
        if (value == null) return null;
        if (type === "TEXT") {
          if (typeof value !== "string")
            fail("INVALID_SNAPSHOT", `${table}.${key} must be text or null.`);
          bytes += Buffer.byteLength(value, "utf8");
          return value;
        }
        if (typeof value === "boolean") return Number(value);
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (type === "INTEGER" && !Number.isSafeInteger(value))
        )
          fail("INVALID_SNAPSHOT", `${table}.${key} must be a finite ${type.toLowerCase()}.`);
        bytes += 8;
        return value;
      });
      if (bytes > LIMITS.snapshotBytes)
        fail("SNAPSHOT_TOO_LARGE", "SQL snapshot exceeds 32 MiB; narrow the source snapshot.");
      return row;
    });
  }
  return { tables: normalized, counts, bytes };
}

function executeSQL(DatabaseSync: unknown, snapshot: unknown, requestValue: unknown): SQLResult {
  if (typeof DatabaseSync !== "function")
    fail("SQL_UNAVAILABLE", "The host must provide node:sqlite DatabaseSync.");
  const started = Date.now();
  const request = (requestValue || {}) as InputParameters;
  const sql = validateSQL(request.sql);
  const params = normalizeParameters(request.params);
  const limit = (request.limit == null ? LIMITS.defaultRows : request.limit) as number;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.rows)
    fail("INVALID_LIMIT", `limit must be an integer from 1 to ${LIMITS.rows}.`);
  const data = normalizeSnapshot(snapshot);
  let db: SQLiteDatabase | undefined;
  try {
    // The injected constructor is checked above; capability checks follow construction.
    const Constructor = DatabaseSync as SQLiteConstructor;
    db = new Constructor(":memory:", {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    assertSQLiteCapabilities(db);
    // Process-local SQLite heap ceiling; this module runs in its own child.
    db.exec(
      "PRAGMA hard_heap_limit=134217728; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF;"
    );
    db.exec("BEGIN");
    for (const [table, schema] of Object.entries(SCHEMA)) {
      const columns = Object.keys(schema);
      db.exec(
        `CREATE TABLE "${table}" (${Object.entries(schema)
          .map(([name, type]) => `"${name}" ${type}`)
          .join(",")}) STRICT`
      );
      const insert = db.prepare(
        `INSERT INTO "${table}" VALUES (${columns.map(() => "?").join(",")})`
      );
      try {
        for (const row of data.tables[table]!) insert.run(...row);
      } finally {
        if (typeof insert.close === "function") insert.close();
      }
    }
    db.exec(
      "CREATE INDEX notes_path ON notes(path); CREATE INDEX headings_path ON headings(path); CREATE INDEX links_source ON links(source); CREATE INDEX links_target ON links(target); CREATE INDEX tags_tag ON tags(tag); CREATE INDEX properties_key ON properties(key); COMMIT; PRAGMA query_only=ON;"
    );
    if (typeof db.setAuthorizer === "function") {
      // Stable SQLite authorizer action codes: READ=20, SELECT=21,
      // FUNCTION=31, RECURSIVE=33; SQLITE_DENY=1, SQLITE_OK=0.
      db.setAuthorizer((action, one, two) => {
        if (action === 21 || action === 33) return 0;
        if (action === 20) return Object.hasOwn(SCHEMA, one as PropertyKey) ? 0 : 1;
        if (action === 31) return forbidden.has(String(two || one).toUpperCase()) ? 1 : 0;
        return 1;
      });
    }
    const statement = db.prepare(sql);
    let iterator: IterableIterator<SQLiteOutput[]> | undefined;
    try {
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      const columns = statement.columns().map((column) => column.name);
      if (columns.length > 100)
        fail("RESULT_TOO_WIDE", "SQL results may have at most 100 columns.");
      const rows: SQLResult["rows"] = [],
        cellTruncations: SQLResult["cellTruncations"] = [];
      iterator = Array.isArray(params) ? statement.iterate(...params) : statement.iterate(params);
      let truncated = false;
      for (const row of iterator) {
        if (rows.length === limit) {
          truncated = true;
          break;
        }
        rows.push(
          row.map((value, column) => {
            if (typeof value === "bigint")
              return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
                value >= BigInt(Number.MIN_SAFE_INTEGER)
                ? Number(value)
                : value.toString();
            if (value instanceof Uint8Array)
              value = `base64:${Buffer.from(value).toString("base64")}`;
            if (typeof value === "string" && value.length > LIMITS.cellChars) {
              cellTruncations.push({ row: rows.length, column, originalChars: value.length });
              return value.slice(0, LIMITS.cellChars);
            }
            return value;
          })
        );
      }
      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        cellTruncations,
        limit,
        snapshot: { ...data.counts, bytes: data.bytes },
        durationMs: Date.now() - started,
        readOnly: true,
      };
    } finally {
      if (iterator && typeof iterator.return === "function") iterator.return();
      if (typeof statement.close === "function") statement.close();
    }
  } catch (caught) {
    const error = caught as BridgeFault;
    if (error.code && !String(error.code).startsWith("ERR_SQLITE")) throw error;
    return fail("SQL_ERROR", String(error.message || error));
  } finally {
    if (db) db.close();
  }
}

export { SCHEMA, LIMITS, validateSQL, executeSQL };
