import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ChunkReload } from "@/components/ChunkReload";

export const metadata: Metadata = {
  title: "운영비 정산 — solibee",
  description: "프로젝트 시스템 운영비 입력·정산·상신",
  // 아이폰 홈 화면에 추가할 때 아이콘 아래 이름
  appleWebApp: { title: "Solibee" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 화면 끝까지 그리고 env(safe-area-inset-*)로 여백을 준다 — 이게 없으면 홈 화면 앱(standalone)에서 safe-area 값이 0이라 하단 탭이 홈 인디케이터에 가린다
  viewportFit: "cover",
  // 모바일 키보드가 열리면 화면(레이아웃) 높이를 줄여 하단 고정 버튼이 키보드 위에 오도록 (Chrome·Firefox Android, Safari는 무시)
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

// 첫 렌더 전에 테마 적용 (깜빡임 방지): 저장된 설정 > 시스템 설정
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <ChunkReload />
        {children}
      </body>
    </html>
  );
}
