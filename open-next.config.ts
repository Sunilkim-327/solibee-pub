// OpenNext(Cloudflare) 설정
// 미리 만든 화면(로그인·비밀번호 변경·404 — 빌드 표에서 ○)은 정적 자산 캐시에서 바로 돌려준다.
//  - incrementalCache: 빌드 때 만든 HTML·RSC를 Workers 정적 자산(cdn-cgi/_next_cache)에서 읽는다 (읽기 전용, 재검증 없음 — ISR을 쓰지 않으므로 충분)
//    배포(opennextjs-cloudflare deploy)가 populateCache로 자동으로 채운다.
//  - enableCacheInterception: 캐시에 있는 화면은 Next 서버 모듈을 불러오지 않고 응답 (운영 CPU — 예전에는 로그인 화면도 요청마다 다시 렌더링)
// 나머지 화면은 모두 동적(ƒ)이라 영향 없음.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
