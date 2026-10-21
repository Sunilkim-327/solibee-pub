import Link from "next/link";
import { Icon } from "./icons";
import { backTo } from "@/lib/page-ctx";

/**
 * 다른 화면의 확인 항목에서 넘어왔을 때(?from=…) 위에 붙어 다니는 '돌아가기' 띠 —
 * 아래로 스크롤해도 보이므로 확인한 뒤 한 번에 돌아간다.
 * 주소·문구는 lib/page-ctx BACK_FROM 표 하나 (from 값을 모르면 그리지 않음). ym: 보던 달을 함께 넘긴다
 */
export function BackTo({ from, ym }: { from: string | string[] | undefined; ym?: string }) {
  const b = backTo(from, { ym });
  if (!b) return null;
  const { href, label } = b;
  return (
    <div className="sticky top-14 z-20 -mx-4 mb-3 bg-canvas/95 px-4 py-1.5 backdrop-blur lg:top-16 lg:-mx-8 lg:px-8">
      <Link href={href} className="btn-secondary btn-sm inline-flex gap-1">
        <Icon name="prev" className="size-4" /> {label}
      </Link>
    </div>
  );
}
