import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// pnpm serve: 사내 PC에서 http로 띄우는 실사용 서버 — HSTS를 보내지 않는다
const isHttps = isProd && process.env.LOCAL_HTTP !== "1";

// 콘텐츠 보안 정책 — 외부 리소스는 Pretendard 글꼴(jsDelivr)만. 'unsafe-inline' 스크립트는 테마 깜빡임 방지
// 인라인 스크립트(app/layout.tsx)와 Next 런타임 인라인 스크립트 때문에 필요 (nonce 도입 시 제거 가능)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // 웹 푸시 서비스 워커(public/sw.js)
  "worker-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // 검증용 서버(별도 DB·포트)를 함께 띄울 때 빌드 폴더가 섞이지 않도록 (NEXT_DIST_DIR=.next-e2e)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cloudflare 빌드(CF_BUILD=1, scripts/cf-build.mjs): Prisma를 번들하지 않아야 OpenNext가 workerd용(wasm) 파일을 고른다
  serverExternalPackages: process.env.CF_BUILD === "1" ? ["exceljs", "@prisma/client", ".prisma/client"] : ["exceljs"],
  // lib/db.ts가 D1 어댑터를 쓸지 정하는 빌드 시점 값
  env: { DB_TARGET: process.env.CF_BUILD === "1" ? "d1" : "local" },
  poweredByHeader: false,
  // 개발 서버: DB 파일(prisma/*.db)·백업·참고 엑셀이 바뀔 때마다 다시 컴파일하지 않도록 감시 제외
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/prisma/**", "**/sample/**", "**/.next-e2e/**", "**/.next/**", "**/.next-*/**"],
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] },
      // 서비스 워커는 매번 새로 확인 (배포 즉시 갱신) · 범위는 사이트 전체
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
