/**
 * node:sqlite driver adapter — exposes a better-sqlite3-compatible surface
 * over Node's built-in `node:sqlite` (DatabaseSync).
 *
 * Why this exists: we migrated off `better-sqlite3` to eliminate the only
 * dependency that could fall back to node-gyp compilation (on new Node ABIs
 * or uncommon platforms where no prebuilt binary is published). `node:sqlite`
 * is a C-backed binding shipped with Node itself — same performance tier,
 * no install-time compilation, no `--allow-scripts` ceremony.
 *
 * The adapter papers over the two real API differences:
 *
 * 1. **Named-parameter binding.** better-sqlite3 accepts a bare object
 *    (`{ id: 'x' }`) and matches it against `@id` / `:id` / `$id` markers
 *    interchangeably. `node:sqlite` requires the object keys to carry the
 *    *same* sigil as the SQL marker (`{ ':id': 'x' }` for `:id`). Since the
 *    existing repositories were written for better-sqlite3 and pass bare
 *    objects with `@name` markers in SQL, we normalize here: on `prepare`
 *    we rewrite all markers to `:name`, and on `run`/`get`/`all` we prefix
 *    bare object keys with `:` so they bind correctly.
 *
 * 2. **Transactions.** better-sqlite3 exposes `db.transaction(fn)` returning
 *    a callable bound transaction. `node:sqlite` has no such helper, so we
 *    reimplement it with `BEGIN`/`COMMIT`/`ROLLBACK`, including nesting via
 *    SAVEPOINTs (the existing code calls `db.transaction(fn)()` and the
 *    `transaction(db, fn)` helper in database.ts, both of which must keep
 *    working).
 *
 * Everything else (`prepare().get/all/run`, `exec`, `close`, positional `?`
 * params, BLOB/Buffer bindings) is a 1:1 pass-through.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * Matches named-parameter markers in SQL: `@name`, `:name`, or `$name`.
 * Captures the sigil and the name. Does not match `@@` (column refs in some
 * dialects) or `::` (Postgres casts) — not used in this codebase.
 */
const NAMED_PARAM_RE = /([@:$])([A-Za-z_][A-Za-z0-9_]*)/g;

/** Rewrite every named marker to `:name` so node:sqlite sees a single form. */
function normalizeNamedMarkers(sql: string): string {
  return sql.replace(NAMED_PARAM_RE, ':$2');
}

/**
 * Extract the set of named-parameter names referenced by a SQL string, after
 * normalizing all markers (`@name`/`:name`/`$name`) to `:name`. Used to filter
 * the params object so that keys with no matching placeholder are dropped —
 * node:sqlite rejects surplus keys (`Unknown named parameter ':foo'`) whereas
 * better-sqlite3 silently ignores them. Existing repository code routinely
 * passes objects that carry extra fields (e.g. `{ ...input, id, tier, ... }`
 * where `input` has `concepts`/`files`/`scopes` that have no SQL placeholder),
 * so we must replicate better-sqlite3's lenient behavior here.
 */
function extractNamedParams(sql: string): Set<string> {
  const names = new Set<string>();
  for (const m of sql.matchAll(NAMED_PARAM_RE)) {
    names.add(m[2]);
  }
  return names;
}

/**
 * Filter a bare-object params map down to the keys the SQL actually references,
 * and prefix them with `:` so they match the normalized `:name` markers.
 * Positional params (arrays / primitives / TypedArrays) pass through untouched.
 */
function normalizeParams(params: unknown, names: Set<string>): unknown {
  if (params === null || params === undefined) return params;
  if (typeof params !== 'object') return params; // primitive (string/number/...)
  if (Array.isArray(params)) return params; // positional
  if (params instanceof Float32Array || params instanceof Uint8Array || params instanceof ArrayBuffer) {
    return params; // raw vector / blob binding — pass through
  }
  const obj = params as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // Strip an existing sigil to get the bare name, then keep only if the SQL
    // references it. (Existing keys in this codebase are bare, no sigil.)
    const bare = k.startsWith(':') || k.startsWith('@') || k.startsWith('$') ? k.slice(1) : k;
    if (names.has(bare)) out[':' + bare] = v;
  }
  return out;
}

/** Wrap a node:sqlite StatementSync to accept bare-object named params. */
class StatementAdapter {
  constructor(
    private readonly stmt: StatementSync,
    private readonly namedParams: Set<string>
  ) {}

  get(...params: unknown[]): unknown {
    const [first, ...rest] = params;
    if (this.isBareObject(first)) {
      return this.stmt.get(normalizeParams(first, this.namedParams) as Record<string, unknown> as never, ...rest as never[]);
    }
    return this.stmt.get(...(params as never[]));
  }
  all(...params: unknown[]): unknown[] {
    const [first, ...rest] = params;
    if (this.isBareObject(first)) {
      return this.stmt.all(normalizeParams(first, this.namedParams) as Record<string, unknown> as never, ...rest as never[]) as unknown[];
    }
    return this.stmt.all(...(params as never[])) as unknown[];
  }
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const [first, ...rest] = params;
    if (this.isBareObject(first)) {
      return this.stmt.run(normalizeParams(first, this.namedParams) as Record<string, unknown> as never, ...rest as never[]) as { changes: number; lastInsertRowid: number | bigint };
    }
    return this.stmt.run(...(params as never[])) as { changes: number; lastInsertRowid: number | bigint };
  }

  /**
   * True when the first argument is a bare object that better-sqlite3 would
   * treat as named parameters (i.e. not an array, not a TypedArray/Buffer,
   * not null). Raw vector/blob bindings (Float32Array/Uint8Array) are
   * positional and must NOT be treated as named-param objects.
   */
  private isBareObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Float32Array) && !(v instanceof Uint8Array) && !(v instanceof ArrayBuffer);
  }
}

/** A better-sqlite3-compatible connection wrapper. */
export class DatabaseAdapter {
  private readonly db: DatabaseSync;
  private readonly txDepth: number[] = [];

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementAdapter {
    const normalized = normalizeNamedMarkers(sql);
    const namedParams = extractNamedParams(normalized);
    return new StatementAdapter(this.db.prepare(normalized), namedParams);
  }

  close(): void {
    this.db.close();
  }

  /**
   * better-sqlite3-compatible bound transaction. Returns a callable that,
   * when invoked, runs `fn` inside a transaction. Supports nesting via
   * SAVEPOINTs (the existing code occasionally nests via the
   * `transaction(db, fn)` helper).
   *
   *   const tx = db.transaction(() => { ... });
   *   tx();
   *
   * Mirrors better-sqlite3 semantics: on throw, the transaction rolls back
   * and the error re-throws; the callable returns whatever `fn` returns.
   */
  transaction<T>(fn: () => T): () => T {
    return () => this.runInTransaction(fn);
  }

  private runInTransaction<T>(fn: () => T): T {
    const depth = this.txDepth.length;
    const savepointName = `mw_tx_${depth}`;
    if (depth === 0) {
      this.db.exec('BEGIN');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    }
    this.txDepth.push(depth);
    try {
      const result = fn();
      this.txDepth.pop();
      if (depth === 0) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      return result;
    } catch (err) {
      this.txDepth.pop();
      if (depth === 0) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      throw err;
    }
  }
}

/**
 * The `Db` type the rest of the codebase depends on. Matches the subset of
 * better-sqlite3's `Database` API actually in use: `exec`, `prepare`, `close`,
 * `transaction`. Repositories hold a `Db` and call only those four.
 */
export type Db = DatabaseAdapter;
