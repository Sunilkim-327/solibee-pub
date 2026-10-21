// 실사용 서버: 프로덕션 빌드로 띄워 화면 반응 속도를 일정하게 (개발 서버는 화면을 처음 열 때마다 컴파일해 수 초씩 걸린다)
// 사용: pnpm serve [포트=3000]   — DB 백업 → 빌드(.next-prod) → 시작. 코드가 바뀌면 다시 실행
import { spawn, spawnSync } from "node:child_process";

const port = process.argv[2] || "3000";
const env = { ...process.env, NEXT_DIST_DIR: ".next-prod", LOCAL_HTTP: "1" };
for (const cmd of ["node scripts/db-backup.mjs --quiet", "pnpm next build"]) {
  if (spawnSync(cmd, { stdio: "inherit", shell: true, env }).status !== 0) {
    console.error(`실패: ${cmd}`);
    process.exit(1);
  }
}
spawn(`pnpm next start -p ${port}`, { stdio: "inherit", shell: true, env });
