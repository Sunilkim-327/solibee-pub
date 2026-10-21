import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Prisma 런타임은 처음 Prisma로 조회할 때 불러온다 — 직접 SQL만 쓰는 요청(로그인·세션·현황·지출 입력 등)은
 * Prisma 런타임(wasm 컴파일러 포함)을 평가하지 않는다 (운영 Workers CPU). 웹팩 외부 모듈 require라 정적 import와 같은 파일을 고른다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadPrisma = () => require("@prisma/client") as typeof import("@prisma/client");
/** 타입 계산 전용 (실행되지 않음) */
declare const PrismaClientForTypes: typeof import("@prisma/client").PrismaClient;

/**
 * 금액 칸(BigInt, 21억 초과 가능)을 앱에서는 number로 다룬다.
 * 원 단위 정수는 Number.MAX_SAFE_INTEGER(약 9천조)까지 정확하므로 안전하다.
 *
 * 런타임: 모든 조회 결과를 순수 객체로 복사하면서 bigint → number로 바꾼다 (관계·집계 포함).
 *   Prisma result 확장은 결과에 심볼 속성을 붙여 서버→클라이언트 컴포넌트 props로 넘길 수 없으므로 쓰지 않는다.
 * 타입: result 확장을 붙인 클라이언트의 타입만 빌려 금액 칸을 number로 본다 (런타임 값과 같다).
 *   집계(_sum 등)의 타입은 bigint로 남으므로 호출부에서 toNumber()로 감싼다 (런타임에는 이미 number).
 * 저장: Prisma BigInt 칸은 number를 그대로 받는다.
 */
export const toNumber = (v: bigint | number | null | undefined): number => (v == null ? 0 : typeof v === "bigint" ? Number(v) : v);

/** bigint → number, Prisma 결과 객체 → 순수 객체 (Date·Buffer는 그대로) */
function plain<T>(v: T): T {
  if (typeof v === "bigint") return Number(v) as T;
  if (Array.isArray(v)) return v.map(plain) as T;
  if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = plain((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

const num = <K extends string>(field: K) => ({ needs: { [field]: true } as Record<K, true>, compute: (r: Record<K, bigint>) => Number(r[field]) });

/** 타입 전용 — 금액 칸을 number로 보는 클라이언트 타입 (호출하지 않는다) */
function typedClient() {
  return new PrismaClientForTypes().$extends({
    result: {
      expense: { amount: num("amount") },
      budgetLine: { unitPrice: num("unitPrice"), planned: num("planned") },
      contractChange: { amountDelta: num("amountDelta") },
      clientPassUsage: { amount: num("amount") },
      passStatementLine: { amount: num("amount") },
    },
  });
}

function createClient(base: PrismaClient): Db {
  const client = base.$extends({
    name: "money-as-number",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return plain(await query(args));
        },
      },
    },
  });
  return client as unknown as Db;
}

// ───────────────────────── 쿼리 컴파일러 공유 (운영)

type QueryCompiler = { compile(q: string): unknown; compileBatch(q: string): unknown; free(): void };
type QueryCompilerOptions = { datamodel: string; provider: string; connectionInfo: unknown };
type QueryCompilerClass = new (o: QueryCompilerOptions) => QueryCompiler;
type CompilerWasm = { getRuntime(): Promise<Record<string, unknown>>; getQueryCompilerWasmModule(): Promise<unknown>; __shared?: true };

/** 격리(isolate) 안에서 함께 쓰는 쿼리 컴파일러 — 스키마가 같으면 하나만 만든다 */
let sharedCompiler: { opts: QueryCompilerOptions; connection: string; qc: QueryCompiler } | null = null;

/**
 * Prisma(engineType "client")는 클라이언트가 연결될 때마다 wasm 쿼리 컴파일러를 새로 만들며 스키마 전체를 다시 해석한다
 * (측정: 요청마다 수~수십 ms). 운영은 요청마다 클라이언트를 만들므로(위 perRequest) 이 비용을 매 요청 낸다.
 * 컴파일러는 입출력이 없는 순수 계산(조회 → 실행 계획)이라 요청 간에 공유해도 안전하다 — 같은 스키마·연결 정보면 재사용한다.
 * - free()는 무시한다 (다른 요청이 쓰는 중일 수 있음). 컴파일 오류가 나면 공유 인스턴스를 버리고 다음 연결 때 새로 만든다.
 */
export function sharedCompilerClass(Real: QueryCompilerClass): QueryCompilerClass {
  function SharedQueryCompiler(opts: QueryCompilerOptions): QueryCompiler {
    const connection = JSON.stringify(opts.connectionInfo ?? null);
    const s = sharedCompiler;
    const hit = s && s.opts.datamodel === opts.datamodel && s.opts.provider === opts.provider && s.connection === connection;
    const qc = hit ? s.qc : (sharedCompiler = { opts, connection, qc: new Real(opts) }).qc;
    const drop = () => {
      if (sharedCompiler?.qc === qc) sharedCompiler = null;
    };
    const guard = <R>(f: () => R): R => {
      try {
        return f();
      } catch (err) {
        drop();
        throw err;
      }
    };
    return {
      compile: (q) => guard(() => qc.compile(q)),
      compileBatch: (q) => guard(() => qc.compileBatch(q)),
      free: () => {},
    };
  }
  return SharedQueryCompiler as unknown as QueryCompilerClass;
}

/** 테스트용: 공유 컴파일러 비우기 */
export function resetSharedCompiler() {
  sharedCompiler = null;
}

const wrappedRuntimes = new WeakMap<object, Record<string, unknown>>();

/** PrismaClient __internal.configOverride — compilerWasm의 QueryCompiler를 공유 컴파일러로 바꿔 끼운다 */
function shareQueryCompiler<C extends { compilerWasm?: CompilerWasm }>(config: C): C {
  const wasm = config.compilerWasm;
  if (!wasm || wasm.__shared) return config;
  const compilerWasm: CompilerWasm = {
    ...wasm,
    __shared: true,
    async getRuntime() {
      const rt = await wasm.getRuntime();
      let wrapped = wrappedRuntimes.get(rt);
      if (!wrapped) {
        const Shared = sharedCompilerClass(rt.QueryCompiler as QueryCompilerClass);
        // wasm 연결용 함수(__wbg_*)는 그대로, QueryCompiler만 바꾼다
        wrapped = new Proxy(rt, { get: (t, k) => (k === "QueryCompiler" ? Shared : Reflect.get(t, k)) });
        wrappedRuntimes.set(rt, wrapped);
      }
      return wrapped;
    },
  };
  return { ...config, compilerWasm };
}

export type Db = ReturnType<typeof typedClient>;
/** 트랜잭션 안의 클라이언트 (prisma.$transaction(async (tx) => …)의 tx) */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

// 키 이름을 바꾸면 개발 서버가 새 클라이언트를 만든다 (확장 방식이 바뀌었을 때)
const globalForPrisma = globalThis as unknown as { prismaMoney?: Db };

/**
 * 운영(Cloudflare Workers, DB_TARGET=d1 — next.config.ts)은 D1 바인딩에 어댑터로 연결하고 **요청마다** 클라이언트를 만든다.
 * Workers는 한 요청에서 만든 Promise·I/O를 다른 요청이 기다리면 "멈춘 요청"으로 보고 끊는다(Prisma 내부 연결 대기 등).
 * 요청 컨텍스트 객체(OpenNext가 요청마다 새로 만듦)를 키로 써서 같은 요청 안에서는 하나를 재사용한다.
 */
const perRequest = new WeakMap<object, Db>();

/**
 * D1은 트랜잭션을 지원하지 않는다(대화형 트랜잭션은 오류). → 같은 클라이언트로 순서대로 실행한다.
 * 원자성은 없으므로 중간 실패 시 일부만 반영될 수 있다 — 지우고 다시 쓰는 곳은 쓰기 순서로 위험을 줄인다.
 */
function withoutTransactions(db: Db): Db {
  const run = async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: Db) => unknown)(proxy);
    const out: unknown[] = [];
    for (const q of arg as Promise<unknown>[]) out.push(await q);
    return out;
  };
  const proxy: Db = new Proxy(db, {
    get(t, key) {
      if (key === "$transaction") return run;
      const v = Reflect.get(t, key);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return proxy;
}

function getClient(): Db {
  if (process.env.DB_TARGET === "d1") {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    const { PrismaD1 } = require("@prisma/adapter-d1") as typeof import("@prisma/adapter-d1");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const cf = getCloudflareContext();
    let db = perRequest.get(cf);
    if (!db) {
      const binding = (cf.env as unknown as { DB: ConstructorParameters<typeof PrismaD1>[0] }).DB;
      // 쿼리 컴파일러 요청 간 공유 (스키마 해석을 격리당 한 번만) — 운영 빌드에서 검증 전이라 환경 변수 PRISMA_SHARED_COMPILER=1일 때만 켠다
      const share = (cf.env as unknown as { PRISMA_SHARED_COMPILER?: string }).PRISMA_SHARED_COMPILER === "1";
      const options = { adapter: new PrismaD1(binding), ...(share ? { __internal: { configOverride: shareQueryCompiler } } : {}) };
      db = withoutTransactions(createClient(new (loadPrisma().PrismaClient)(options as ConstructorParameters<typeof PrismaClient>[0])));
      perRequest.set(cf, db);
    }
    return db;
  }
  return (globalForPrisma.prismaMoney ??= createClient(new (loadPrisma().PrismaClient)()));
}

/** 첫 사용 때 만들어지는 클라이언트 (Workers에서는 모듈 로드 시점에 D1 바인딩이 없다) */
export const prisma: Db = new Proxy({} as Db, {
  get(_t, key) {
    const c = getClient() as unknown as Record<PropertyKey, unknown>;
    const v = c[key];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

// ───────────────────────── D1 일괄 실행 (운영)

type D1Like = { prepare(sql: string): { bind(...v: unknown[]): unknown }; batch(stmts: unknown[]): Promise<unknown[]> };

/** D1에 저장되는 값 형식으로 (Prisma D1 어댑터와 같게: 날짜는 "…T…+00:00" 글자, 참/거짓은 1/0) */
export function d1Value(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().replace("Z", "+00:00");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  return v;
}

/**
 * 운영(D1)에서 여러 SQL을 한 번의 요청으로 **원자적으로** 실행한다 (전부 반영되거나 전부 취소).
 * Prisma로 대량 저장하면 D1의 쿼리당 값 100개 제한 때문에 수십~수백 쿼리로 쪼개져 요청당 쿼리 수·CPU 한도를 넘는다.
 * 운영이 아니면(로컬 SQLite) false — 호출부가 Prisma로 처리한다.
 */
export async function d1Batch(stmts: { sql: string; params: unknown[] }[]): Promise<boolean> {
  if (process.env.DB_TARGET !== "d1") return false;
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  const db = (getCloudflareContext().env as unknown as { DB: D1Like }).DB;
  if (stmts.length) await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params.map(d1Value))));
  return true;
}

/** d1Batch로 넣는 행의 id (Prisma 기본값 대신 직접 만든다) */
export const newRowId = (prefix = "l") => prefix + crypto.randomUUID().replace(/-/g, "");

/** D1 쿼리당 바인딩 값 상한 */
const D1_MAX_PARAMS = 100;

/**
 * 여러 행 INSERT 문 (d1Batch용) — 쿼리당 값 100개 제한에 맞춰 여러 행씩 묶는다.
 * 열은 첫 행의 키 순서 (모든 행이 같은 키를 가져야 한다). 값 변환은 d1Batch가 d1Value로 한다.
 */
export function insertStatements(table: string, rows: Record<string, unknown>[]): { sql: string; params: unknown[] }[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const per = Math.max(1, Math.floor(D1_MAX_PARAMS / cols.length));
  const tuple = `(${cols.map(() => "?").join(",")})`;
  const out: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    out.push({
      sql: `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${chunk.map(() => tuple).join(",")}`,
      params: chunk.flatMap((r) => cols.map((c) => r[c])),
    });
  }
  return out;
}

/** id 목록으로 지우는 DELETE 문 (d1Batch용) — 쿼리당 값 100개 제한에 맞춰 나눈다 */
export function deleteByIdStatements(table: string, ids: string[]): { sql: string; params: unknown[] }[] {
  const out: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < ids.length; i += D1_MAX_PARAMS) {
    const chunk = ids.slice(i, i + D1_MAX_PARAMS);
    out.push({ sql: `DELETE FROM "${table}" WHERE "id" IN (${chunk.map(() => "?").join(",")})`, params: chunk });
  }
  return out;
}

type D1Res = { meta?: { changes?: number } };

/**
 * 운영(D1)에서 문장들을 한 번에 실행하고 문장별 영향 행 수를 돌려준다 (조건부 쓰기의 성공 여부 확인용).
 * 운영이 아니면 null — 호출부가 Prisma 경로로 처리한다.
 */
export async function d1Changes(stmts: { sql: string; params: unknown[] }[]): Promise<number[] | null> {
  if (process.env.DB_TARGET !== "d1") return null;
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  const db = (getCloudflareContext().env as unknown as { DB: D1Like }).DB;
  if (!stmts.length) return [];
  const res = (await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params.map(d1Value))))) as D1Res[];
  return res.map((r) => r.meta?.changes ?? 0);
}

// ───────────────────────── 직접 SQL 조회 (자주 쓰는 조회 — Prisma 쿼리 컴파일·해석 비용 없이)

type D1Stmt = { all(): Promise<{ results?: unknown[] }>; run(): Promise<{ meta?: { changes?: number } }> };
type D1Direct = { prepare(sql: string): { bind(...v: unknown[]): D1Stmt } };
export type SqlParam = string | number | boolean | null | Date;

function d1Direct(): D1Direct {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  return (getCloudflareContext().env as unknown as { DB: D1Direct }).DB;
}

/**
 * SQL 매개변수 → 그 환경의 저장 형식 (Prisma가 쓰는 형식과 같게).
 * 운영(D1): 날짜 "…T…+00:00" 글자·참/거짓 1/0 (d1Value) / 로컬(SQLite, Prisma 기본 엔진): 날짜 밀리초 정수·참/거짓 1/0
 */
export function sqlParam(v: SqlParam): string | number | null {
  if (process.env.DB_TARGET === "d1") return d1Value(v) as string | number | null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

/**
 * SELECT 결과 행 (열 이름 그대로, 값은 DB 원형). 운영은 D1 바인딩으로 바로, 로컬은 Prisma 원시 조회로.
 * 값 형식이 운영(D1: 날짜 글자, 참/거짓 1/0)과 로컬(SQLite: 날짜 밀리초 정수 등)이 다르므로 반드시 sqlDate·sqlBool·sqlInt로 읽는다.
 * 날짜 매개변수는 sqlParam이 그 환경의 저장 형식으로 바꾼다 (같은 형식끼리 비교 — Prisma 조건과 같은 결과).
 */
export async function sqlRows<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  const values = params.map(sqlParam);
  if (process.env.DB_TARGET === "d1") {
    const res = await d1Direct().prepare(sql).bind(...values).all();
    return (res.results ?? []) as T[];
  }
  const base = getClient() as unknown as { $queryRawUnsafe(sql: string, ...v: unknown[]): Promise<unknown[]> };
  return (await base.$queryRawUnsafe(sql, ...values)) as T[];
}

/** INSERT·UPDATE·DELETE 한 문장 → 바뀐 행 수 */
export async function sqlExec(sql: string, params: SqlParam[] = []): Promise<number> {
  const values = params.map(sqlParam);
  if (process.env.DB_TARGET === "d1") {
    const res = await d1Direct().prepare(sql).bind(...values).run();
    return res.meta?.changes ?? 0;
  }
  const base = getClient() as unknown as { $executeRawUnsafe(sql: string, ...v: unknown[]): Promise<number> };
  return base.$executeRawUnsafe(sql, ...values);
}

let cuidCounter = Math.floor(Math.random() * 36 ** 4);
/**
 * Prisma @default(cuid())와 같은 모양의 id (c + 시각 + 카운터 + 무작위, 25자) — 직접 SQL로 넣는 행용.
 * 시각이 앞에 있어 같은 시각 기록의 id 정렬(감사 로그의 createdAt·id 순)이 Prisma로 넣은 행과 같은 성질을 갖는다.
 */
export function newCuid(): string {
  cuidCounter = (cuidCounter + 1) % 36 ** 4;
  const rnd = crypto.getRandomValues(new Uint32Array(3));
  const block = (n: number) => (n % 36 ** 4).toString(36).padStart(4, "0");
  return "c" + Date.now().toString(36).padStart(8, "0") + block(cuidCounter) + block(rnd[0]) + block(rnd[1]) + block(rnd[2]);
}

// Prisma(쿼리 해석기)와 같은 규칙으로 DB 값을 읽는다 — SQLite 날짜 글자 정규화(시간대·공백·날짜만)까지 같게
const TIME_RE = /\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
function normalizeDateText(e: string): string {
  const t = TIME_RE.exec(e);
  if (t === null) return `${e}T00:00:00Z`;
  let r = e;
  const [whole, zone, minutes] = t;
  if (zone !== undefined && zone !== "Z" && minutes === undefined) r = `${e}:00`;
  else if (zone === undefined) r = `${e}Z`;
  if (whole.length === e.length) return `1970-01-01T${r}`;
  const s = t.index - 1;
  if (r[s] === " ") r = `${r.slice(0, s)}T${r.slice(s + 1)}`;
  return r;
}

/** DateTime 칸 → Date (없으면 null) */
export function sqlDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "bigint") return new Date(Number(v));
  if (typeof v === "string") return new Date(normalizeDateText(v));
  throw new Error(`날짜 값을 읽을 수 없습니다: ${typeof v}`);
}
/** 필수 DateTime 칸 */
export const sqlDateReq = (v: unknown): Date => sqlDate(v) as Date;

/** Boolean 칸 (1/0, true/false, "1"/"true") */
export function sqlBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "bigint") return v === BigInt(1);
  if (typeof v === "string") return v === "true" || v === "TRUE" || v === "1";
  return false;
}

/** Int·BigInt 칸 → number (없으면 null) */
export function sqlInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "bigint") return Number(v);
  return Math.trunc(Number(v));
}
/** 필수 Int 칸 */
export const sqlIntReq = (v: unknown): number => sqlInt(v) as number;
/** String? 칸 */
export const sqlStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
