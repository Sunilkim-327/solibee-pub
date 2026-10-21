import { NextResponse } from "next/server";
import { apiUser, audit, route } from "@/lib/access";
import { solidayConfig } from "@/lib/directory-sync";
import { createPurposeToken } from "@/lib/session";

const TTL_SEC = 10 * 60;

/**
 * Soliday 조직도 전송 링크(북마클릿) 발급 — 시스템 관리자, 10분 유효·1회용 (한 번 전송하면 새로 만들어야 함)
 * Soliday에 로그인한 브라우저에서 실행하면 부서·임직원(이름·이메일·부서·직위·재직상태)만 이 앱으로 보낸다.
 */
export const POST = route(async (req) => {
  const admin = await apiUser(["ADMIN"]);
  const token = createPurposeToken("directory-push", admin.id, TTL_SEC);
  const appOrigin = new URL(req.url).origin;
  const soliday = solidayConfig().baseUrl;
  const code = `(async()=>{try{if(location.origin!==${JSON.stringify(new URL(soliday).origin)}){alert("Soliday(${new URL(soliday).host}) 화면에서 실행하세요.");return}const g=u=>fetch(u,{credentials:"include"}).then(r=>{if(!r.ok)throw new Error(u+" "+r.status);return r.json()});const[d,e]=await Promise.all([g("/api/departments"),g("/api/org/employees")]);const D=(d.departments||d).map(x=>({id:x.id,departmentCode:x.departmentCode,departmentName:x.departmentName,departmentLevel:x.departmentLevel,departmentOrder:x.departmentOrder,parentId:x.parentId,hidden:x.hidden}));const E=(e.employees||e).map(x=>({id:x.id,fullName:x.fullName,emailAddress:x.emailAddress,employeeNumber:x.employeeNumber,employeeStatus:x.employeeStatus,department:x.department&&{departmentCode:x.department.departmentCode},title:x.title&&{titleName:x.title.titleName}}));const r=await fetch(${JSON.stringify(appOrigin + "/api/directory/push")},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:${JSON.stringify(token)},departments:D,employees:E})});const j=await r.json();alert(r.ok?"운영비 정산으로 전송 완료\\n부서 "+j.departments+" · 임직원 "+j.employees+"\\n시스템 관리자 화면에서 미리보기 후 적용하세요.":"전송 실패: "+j.error)}catch(err){alert("가져오기 실패: "+err.message)}})()`;
  await audit(admin, { entity: "Directory", entityId: "token", action: "push-link" });
  return NextResponse.json({
    token,
    expiresAt: new Date(Date.now() + TTL_SEC * 1000).toISOString(),
    solidayUrl: `${soliday}/org`,
    bookmarklet: `javascript:${encodeURIComponent(code)}`,
  });
});
