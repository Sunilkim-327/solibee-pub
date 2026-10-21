// 운영(D1)에서 Prisma 쿼리 컴파일러를 요청 간에 공유하는 래퍼 (lib/db.ts sharedCompilerClass)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSharedCompiler, sharedCompilerClass } from "@/lib/db";

type Opts = { datamodel: string; provider: string; connectionInfo: unknown };

class FakeCompiler {
  static made = 0;
  freed = false;
  constructor(public opts: Opts) { FakeCompiler.made++; }
  compile(q: string) { if (q === "bad") throw new Error("invalid"); return `plan:${q}`; }
  compileBatch(q: string) { return `batch:${q}`; }
  free() { this.freed = true; }
}

const opts = (datamodel = "model A { id Int @id }"): Opts => ({ datamodel, provider: "sqlite", connectionInfo: { supportsRelationJoins: false } });

describe("쿼리 컴파일러 공유", () => {
  beforeEach(() => { resetSharedCompiler(); FakeCompiler.made = 0; });

  it("같은 스키마·연결 정보면 한 번만 만든다 (요청마다 스키마 해석 안 함)", () => {
    const Shared = sharedCompilerClass(FakeCompiler as never);
    const a = new Shared(opts());
    const b = new Shared(opts());
    expect(FakeCompiler.made).toBe(1);
    expect(a.compile("q1")).toBe("plan:q1");
    expect(b.compileBatch("q2")).toBe("batch:q2");
  });

  it("free()는 무시 (다른 요청이 쓰는 중일 수 있음)", () => {
    const Shared = sharedCompilerClass(FakeCompiler as never);
    const a = new Shared(opts());
    a.free();
    new Shared(opts()).compile("q");
    expect(FakeCompiler.made).toBe(1);
  });

  it("스키마·연결 정보가 다르면 새로 만든다", () => {
    const Shared = sharedCompilerClass(FakeCompiler as never);
    new Shared(opts("model A { id Int @id }"));
    new Shared(opts("model B { id Int @id }"));
    new Shared({ ...opts("model B { id Int @id }"), connectionInfo: { supportsRelationJoins: true } });
    expect(FakeCompiler.made).toBe(3);
  });

  it("컴파일 오류가 나면 공유 인스턴스를 버린다 (다음 연결 때 새로)", () => {
    const Shared = sharedCompilerClass(FakeCompiler as never);
    const a = new Shared(opts());
    expect(() => a.compile("bad")).toThrow("invalid");
    new Shared(opts());
    expect(FakeCompiler.made).toBe(2);
  });

  it("실제 wasm 컴파일러: 공유 인스턴스의 실행 계획 = 새 인스턴스의 실행 계획", () => {
    const req = createRequire(import.meta.url);
    const rt = req("@prisma/client/runtime/query_compiler_bg.sqlite.js");
    const { wasm } = req("@prisma/client/runtime/query_compiler_bg.sqlite.wasm-base64.js");
    (globalThis as { PRISMA_WASM_PANIC_REGISTRY?: unknown }).PRISMA_WASM_PANIC_REGISTRY ??= { set_message() {} };
    const inst = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(wasm, "base64")), { "./query_compiler_bg.js": rt });
    rt.__wbg_set_wasm(inst.exports);
    (inst.exports.__wbindgen_start as () => void)();
    const datamodel = readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    const o = { datamodel, provider: "sqlite", connectionInfo: { supportsRelationJoins: false, maxBindValues: 100 } };
    const Shared = sharedCompilerClass(rt.QueryCompiler);
    const q = JSON.stringify({ modelName: "User", action: "findUnique", query: { arguments: { where: { id: "u1" } }, selection: { id: true, name: true, department: { arguments: {}, selection: { name: true } } } } });
    const fresh = new rt.QueryCompiler(o).compile(q);
    const s1 = new Shared(o);
    const s2 = new Shared(o);
    expect(s1.compile(q)).toEqual(fresh);
    expect(s2.compile(q)).toEqual(fresh);
  });
});
