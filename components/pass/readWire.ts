"use client";

/**
 * 업체 파일을 브라우저에서 읽어 서버로 보낼 시트 글자로 (운영 서버는 요청당 CPU가 짧아 엑셀 해석을 여기서).
 * 같은 파일은 한 번만 읽는다. 엑셀 라이브러리는 이때만 불러온다.
 */
export function createWireReader() {
  let cached: { file: File; wire: string } | null = null;
  return async function readWire(f: File): Promise<string> {
    if (cached?.file === f) return cached.wire;
    const [{ fileToSheets }, { sheetsToWire }] = await Promise.all([import("@/lib/pass-import"), import("@/lib/pass-statement")]);
    const wire = sheetsToWire(await fileToSheets(f.name, new Uint8Array(await f.arrayBuffer())));
    cached = { file: f, wire };
    return wire;
  };
}

/** 파일 읽기 오류 문구 */
export const readError = (err: unknown) =>
  err instanceof Error && err.name !== "Error" ? "파일을 읽을 수 없습니다." : (err as Error)?.message || "파일을 읽을 수 없습니다.";
