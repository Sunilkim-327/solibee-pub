import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // server-only는 React 서버 환경이 아니면 throw — 테스트에서는 빈 모듈로 대체
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  // 컴포넌트 렌더 테스트용 (Next와 같은 자동 JSX 런타임)
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.ts"] },
});
