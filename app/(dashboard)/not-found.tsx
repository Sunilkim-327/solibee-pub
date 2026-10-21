import Link from "next/link";
import { Empty } from "@/components/common";
import { BackButton } from "@/components/Nav";

/** 대시보드 안에서 찾을 수 없는 내용 (없는 주소·notFound()) — 메뉴·상단 바 유지 */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <Empty card icon="search" title="요청한 화면을 찾을 수 없습니다"
        action={<><BackButton /><Link href="/" className="btn-primary">첫 화면으로</Link></>}>
        삭제되었거나 주소가 바뀌었을 수 있습니다. 메뉴에서 다시 찾아 보세요.
      </Empty>
    </div>
  );
}
