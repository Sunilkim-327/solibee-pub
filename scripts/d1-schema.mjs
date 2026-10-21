// 운영(Cloudflare Workers + D1)용 Prisma 클라이언트 스키마를 개발용 스키마에서 만든다.
// 모델은 prisma/schema.prisma 하나만 관리하고, 이 스크립트가 generator만 바꿔 prisma/d1/schema.prisma로 쓴다.
//   - 출력: 기본 위치(node_modules/.prisma/client) — Workers 빌드 동안만 바꿔 끼우고, 빌드 후 개발용으로 되돌린다 (scripts/cf-build.mjs)
//   - engineType "client": Rust 엔진 없이 wasm 쿼리 컴파일러 + D1 어댑터
// 사용: scripts/cf-build.mjs가 호출
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const header = `// 자동 생성 — 직접 고치지 말 것 (scripts/d1-schema.mjs, 원본 prisma/schema.prisma)

generator client {
  provider   = "prisma-client-js"
  engineType = "client"
}

datasource db {
  provider = "sqlite"
  url      = "file:./unused.db"
}
`;
const body = src.replace(/generator client \{[\s\S]*?\}\s*/, "").replace(/datasource db \{[\s\S]*?\}\s*/, "").replace(/^(\/\/.*\n)+/, "");
mkdirSync("prisma/d1", { recursive: true });
writeFileSync("prisma/d1/schema.prisma", header + "\n" + body);
console.log("prisma/d1/schema.prisma 생성");
