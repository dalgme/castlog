import "server-only";

import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/supabase/db-errors";
import { recordActionDenial } from "@/lib/monitoring/action-denials";
import { GRADE_LABELS } from "@/lib/auth/grades";
import { isUserGrade } from "@/lib/auth/grades";

/**
 * 사용자에게 돌려주는 실패 문구의 표준 — "거부는 오류가 아니다".
 *
 * 렛츠 사고의 교훈: 프로젝트 생성이 권한 규칙(RLS)에 거부됐을 뿐인데 화면에는
 * "실패했습니다"만 떴다. 사용자는 규칙과 결함을 구분할 수 없으므로 "처음부터
 * 에러가 나는 플랫폼"이라고 판단한다. 신뢰는 기능이 아니라 **거부의 설명**에서
 * 깎인다.
 *
 * 그래서 실패는 세 갈래로 나눠 말한다:
 *  1. 규칙 거부 — 오류가 아니라 회사 권한 설정에 따른 것임을 명시하고,
 *     지금 할 일과 규칙 변경 요청 경로(챗봇)를 함께 준다.
 *  2. 상태 미충족 — 무엇이 언제 충족되는지 (예: 권한 변경 반영 대기).
 *  3. 시스템 결함 — 우리가 고칠 일임을 인정하고 전달 경로를 준다.
 *
 * 이 함수는 RLS 거부(1·2)를 판별한다. 특히 **권한 변경 직후의 반영 시차**를
 * 정확히 짚는다: 화면·서버 게이트는 인증 서버의 최신 권한(getUser)을 보지만,
 * DB의 RLS는 액세스 토큰의 클레임을 본다. 등급을 방금 올린 계정은 재로그인
 * (또는 토큰 만료, 최대 1시간)까지 옛 권한으로 판정된다 — 이걸 말해 주지
 * 않으면 사용자에게는 무작위 오류로 보인다.
 */

const CHATBOT_TAIL =
  " 이 규칙이 업무와 맞지 않으면 화면 오른쪽 아래 챗봇으로 알려 주세요 — 캐스트로그에 규칙 개선 요청으로 전달됩니다.";

function gradeLabelOf(value: unknown): string | null {
  return typeof value === "string" && isUserGrade(value)
    ? GRADE_LABELS[value]
    : null;
}

/** 액세스 토큰의 payload를 읽는다 (서명 검증은 미들웨어가 이미 했다) */
function decodeTokenClaims(
  accessToken: string
): { grade?: unknown; role?: unknown } | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const claims = JSON.parse(json) as {
      app_metadata?: { grade?: unknown; role?: unknown };
    };
    return claims.app_metadata ?? null;
  } catch {
    return null;
  }
}

/**
 * 서버 액션의 DB 실패를 사용자 문구로 옮긴다.
 *
 * RLS 거부일 때 토큰 클레임과 인증 서버의 최신 권한을 대조해,
 * "권한이 방금 바뀌어 아직 반영 전"인 경우를 정확히 말해 준다.
 */
export async function explainActionError(
  message: string | undefined,
  fallback: string
): Promise<string> {
  const isRlsDenial =
    typeof message === "string" &&
    /row-level security|violates.*policy|42501/i.test(message);

  if (!isRlsDenial) {
    // 마이그레이션 미적용·기타는 기존 번역기가 처리한다
    return describeDbError(message, fallback);
  }

  // 모니터링 창이 열려 있으면 RLS 거부를 피드에 자동 기록 (규칙 거부 가시화).
  // 문구 조립 실패와 무관하게 먼저 남긴다 — 기록 실패는 헬퍼가 삼킨다.
  await recordActionDenial({ kind: "rls", message: fallback });

  // 권한 변경 반영 시차인지 판별 — 최신 권한(인증 서버) vs 토큰 클레임
  try {
    const supabase = createClient();
    const [
      {
        data: { user },
      },
      {
        data: { session },
      },
    ] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);

    const tokenClaims = session?.access_token
      ? decodeTokenClaims(session.access_token)
      : null;
    const freshGrade = user?.app_metadata?.grade;
    const tokenGrade = tokenClaims?.grade;

    if (
      user &&
      tokenClaims &&
      (freshGrade !== tokenGrade || user.app_metadata?.role !== tokenClaims.role)
    ) {
      const newLabel = gradeLabelOf(freshGrade);
      const oldLabel = gradeLabelOf(tokenGrade);
      const change =
        newLabel && oldLabel
          ? `권한단계가 ${oldLabel}에서 ${newLabel}(으)로 변경된 지 얼마 되지 않아`
          : "권한이 최근 변경되어";
      return (
        `${fallback} 오류가 아닙니다 — ${change} 아직 이 작업에 반영되지 않았습니다. ` +
        "보안을 위해 권한 변경은 다시 로그인할 때(늦어도 1시간 안에) 적용됩니다. " +
        "로그아웃 후 다시 로그인하면 바로 사용할 수 있습니다." +
        CHATBOT_TAIL
      );
    }
  } catch {
    // 판별 실패는 일반 규칙 거부 문구로 떨어진다 — 문구를 만들다 실패를
    // 또 만들면 안 된다
  }

  return (
    `${fallback} 시스템 오류가 아니라 회사의 권한 규칙에 따라 거부된 것입니다. ` +
    "이 작업에 필요한 권한이 없다면 대표 또는 관리 권한자에게 요청하세요." +
    CHATBOT_TAIL
  );
}
