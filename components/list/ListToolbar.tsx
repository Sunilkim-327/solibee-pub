// 목록 도구 줄 — 검색 input · 칩/탭 필터 · 정렬 select 자리를 한 모양·한 위치로 (전체 프로젝트·접속 기록·프로젝트 설정·조직도).
// "use client" 없음: 서버 컴포넌트(주소 파라미터 방식)와 클라이언트 상태 방식 모두 이 안에 슬롯만 끼운다.
//   - 주소 파라미터 방식: ParamSearch·ParamSelect (components/list/ParamControls.tsx)
//   - 클라이언트 상태 방식: SearchInput + value/onChange
// 배치: 모바일은 필터 줄(가로 스크롤) 위, 검색·정렬·동작 아래 한 줄(검색이 남는 너비). PC는 필터 왼쪽, 검색·정렬·동작 오른쪽.
import { Icon } from "../icons";

export function ListToolbar({ filters, search, sort, actions, children, className = "", label }: {
  /** 칩·세그먼트 탭·선택 필터 (여러 개면 Fragment로) */
  filters?: React.ReactNode;
  /** 검색 input (SearchInput 또는 ParamSearch) */
  search?: React.ReactNode;
  /** 정렬 select·세그먼트 */
  sort?: React.ReactNode;
  /** 오른쪽 끝 동작 버튼 (새로 만들기 등) */
  actions?: React.ReactNode;
  /** 둘째 줄 (필터 칩이 많을 때 FilterChips 등) */
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const right = search || sort || actions;
  return (
    <div className={`mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center ${className}`} role="group" aria-label={label ?? "목록 도구"}>
      {filters && <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
      {right && (
        <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
          {search && <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">{search}</div>}
          {sort}
          {actions}
        </div>
      )}
      {children && <div className="min-w-0 basis-full">{children}</div>}
    </div>
  );
}

/** 돋보기 아이콘이 붙은 검색 input — value/onChange(클라이언트) 또는 name/defaultValue(폼) 그대로 넘긴다 */
export function SearchInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative min-w-0">
      <Icon name="find" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
      <input type="search" className={`input pl-9 ${className}`} {...props} />
    </div>
  );
}
