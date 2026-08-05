import { requireRole } from "@/lib/auth/session";
import { requireModule } from "@/lib/modules/server";
import { xlsxResponse } from "@/lib/exports/xlsx";

/**
 * 전문가 일괄 가져오기 템플릿 다운로드.
 * 휴대폰 컬럼은 문자열 예시를 넣어 텍스트 서식으로 유도한다
 * (숫자 서식이 되면 앞자리 0이 사라진다 — 업로드 쪽에서도 복원 처리).
 */
export async function GET() {
  await requireRole(["platform_admin", "org_admin", "manager"]);
  await requireModule("experts");

  return xlsxResponse("전문가_일괄등록_템플릿", [
    [
      "전문가",
      [
        { 이름: "홍길동", 휴대폰: "010-1234-5678" },
        { 이름: "김철수", 휴대폰: "010-9876-5432" },
      ],
    ],
    [
      "안내",
      [
        { 항목: "이름", 설명: "필수 · 50자 이내" },
        { 항목: "휴대폰", 설명: "필수 · 010-1234-5678 형식 권장 (숫자만 입력해도 됩니다)" },
        {
          항목: "처리 방식",
          설명:
            "행마다 등록 요청 링크(/j)가 생성됩니다. 전문가가 링크에서 휴대폰 인증 후 본인 정보를 직접 등록하면 우리 회사와 연결됩니다.",
        },
        {
          항목: "행 수 제한",
          설명: "한 번에 최대 500행까지 처리됩니다.",
        },
      ],
    ],
  ]);
}
