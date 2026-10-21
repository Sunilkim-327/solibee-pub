// Cloudflare Workers 빌드: Prisma 클라이언트를 D1용(wasm 컴파일러 + 어댑터)으로 바꿔 빌드한 뒤 개발용으로 되돌린다.
// 사용: pnpm cf:build  /  pnpm cf:deploy (빌드 + 배포)
// Windows에서는 돌리지 않는다: Next standalone 빌드가 심볼릭 링크를 못 만들고(EPERM),
// 실행 중인 개발 서버가 Prisma 엔진 파일을 잠가 개발용 클라이언트 복구가 실패한다. → Cloudflare 빌드(리눅스)에서 실행
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  console.error("cf:build는 리눅스(Cloudflare Workers Builds)에서 실행합니다. main에 푸시하면 Cloudflare가 빌드·배포합니다.");
  process.exit(1);
}

const env = { ...process.env, CF_BUILD: "1", NEXT_DIST_DIR: ".next" };
const run = (cmd) => spawnSync(cmd, { stdio: "inherit", shell: true, env }).status === 0;
let ok = run("node scripts/d1-schema.mjs") && run("pnpm prisma generate --schema prisma/d1/schema.prisma") && run("pnpm opennextjs-cloudflare build");
if (ok && process.argv.includes("--deploy")) ok = run("pnpm opennextjs-cloudflare deploy");
// 개발용(SQLite) 클라이언트 복구 — 실패해도 반드시
run("pnpm prisma generate");
process.exit(ok ? 0 : 1);
