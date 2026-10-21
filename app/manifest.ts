import type { MetadataRoute } from "next";

/** 휴대폰 '홈 화면에 추가' 정보 (안드로이드) — 아이콘은 회사 S 마크 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Solibee",
    short_name: "Solibee",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
