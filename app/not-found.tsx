import Link from "next/link";
import { BackButton } from "@/components/Nav";

/** 없는 주소 (로그인 전 등 메뉴가 없는 곳) */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="card w-full max-w-md px-6 py-10 text-center">
        <p className="tabular text-sm font-bold text-fg-subtle">404</p>
        <h1 className="mt-1 text-h1 font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-fg-muted">주소를 다시 확인해 주세요.</p>
        <div className="mt-5 flex justify-center gap-2">
          <BackButton />
          <Link href="/" className="btn-primary">첫 화면으로</Link>
        </div>
      </div>
    </main>
  );
}
