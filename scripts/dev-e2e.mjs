// 검증용 서버: 실제 입력 데이터(dev.db)와 분리된 prisma/e2e.db + 포트 3100 + 별도 빌드 폴더
// 사용: pnpm dev:e2e   (처음이면 e2e.db를 만들고 데모 데이터를 넣는다)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const env = { ...process.env, DATABASE_URL: "file:./e2e.db", NEXT_DIST_DIR: ".next-e2e" };
const run = (cmd) => spawnSync(cmd, { stdio: "inherit", shell: true, env });
if (!existsSync("prisma/e2e.db")) {
  // 처음 만들다 실패하면 반쯤 만든 e2e.db를 지운다 (다음 실행이 시드를 건너뛰지 않도록). dev.db는 건드리지 않는다
  for (const cmd of ["pnpm prisma db push --skip-generate", "pnpm tsx prisma/seed.ts"]) {
    if (run(cmd).status !== 0) {
      rmSync("prisma/e2e.db", { force: true });
      console.error(`e2e.db 준비 실패: ${cmd}`);
      process.exit(1);
    }
  }
}
spawn("pnpm next dev -p 3100", { stdio: "inherit", shell: true, env });
