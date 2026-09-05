import "server-only";

import { existsSync } from "fs";
import path from "path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import type { AcceptanceView } from "@/lib/integrations/acceptance-view";
import { formatKrw } from "@/lib/approvals/constants";
import { roleTypeLabel, formatEventSchedule } from "@/lib/integrations/engagement-roles";
import { PAYMENT_TYPE_LABELS, type PaymentType } from "@/lib/payments/tax";

/**
 * 수락서 PDF (기획 변경 2026-08-30 — 19번).
 *
 * 종전 확정("수락서는 화면으로만, 파일로 내보내지 않는다")을 개정한다:
 * **전문가가 승인(서명)한 수락서에 한해, 기업 담당자가 PDF로 내려받을 수 있다.**
 * 전문가 측은 계속 화면 열람만이다. 다운로드는 감사로그에 남는다.
 *
 * 폰트는 public/fonts의 나눔고딕(TTF, OFL — @react-pdf는 TTF만 지원)을 쓴다.
 * 로컬 파일이 있으면 파일 경로로(개발·자체 호스팅), 없으면 배포 base URL의
 * 정적 경로로 등록한다 — 서버리스 번들에는 public/이 포함되지 않을 수 있다.
 */

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  const localRegular = path.join(dir, "NanumGothic-Regular.ttf");
  const useLocal = existsSync(localRegular);
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const src = (file: string) =>
    useLocal ? path.join(dir, file) : `${base}/fonts/${file}`;
  Font.register({
    family: "NanumGothic",
    fonts: [
      { src: src("NanumGothic-Regular.ttf") },
      { src: src("NanumGothic-Bold.ttf"), fontWeight: 700 },
    ],
  });
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "NanumGothic",
    fontSize: 10,
    lineHeight: 1.5,
    padding: 48,
    color: "#1f2937",
  },
  title: { fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 4 },
  meta: { fontSize: 9, textAlign: "center", color: "#6b7280", marginBottom: 16 },
  row: { flexDirection: "row", borderBottom: "0.5 solid #e5e7eb", paddingVertical: 4 },
  label: { width: 90, color: "#6b7280" },
  value: { flex: 1 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  note: { fontSize: 9, color: "#4b5563", marginTop: 2 },
  declaration: { marginTop: 18, fontSize: 10 },
  signRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 24,
    alignItems: "flex-end",
  },
  signBox: { alignItems: "center" },
  signImage: { height: 48, objectFit: "contain" },
  signCaption: { fontSize: 8, color: "#6b7280", marginTop: 2 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
});

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function kst(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export async function renderAcceptancePdf(view: AcceptanceView): Promise<Buffer> {
  registerFonts();
  const a = view.acceptance;
  const schedule = formatEventSchedule(
    a.starts_on,
    a.ends_on,
    a.starts_time,
    a.ends_time
  );
  const paymentLabel = a.payment_type
    ? (PAYMENT_TYPE_LABELS[a.payment_type as PaymentType] ?? a.payment_type)
    : null;

  const doc = (
    <Document
      title={`섭외 수락서 ${a.letter_no}`}
      author={a.tenant_name}
      creator="CASTLOG"
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>섭외 수락서</Text>
        <Text style={styles.meta}>
          문서번호 {a.letter_no}
          {a.position_code ? ` · ${a.position_code}` : ""}
        </Text>

        <Row label="기업" value={a.tenant_name} />
        <Row label="사업명" value={a.program_name ?? a.project_name} />
        <Row label="세션" value={a.session_name} />
        <Row label="전문가" value={a.expert_name} />
        <Row
          label="구분"
          value={[
            a.role_type ? roleTypeLabel(a.role_type) : null,
            a.role_description,
          ]
            .filter(Boolean)
            .join(" · ") || null}
        />
        <Row label="일정" value={schedule} />
        <Row
          label="장소"
          value={
            a.location_name
              ? a.location_address
                ? `${a.location_name} (${a.location_address})`
                : a.location_name
              : null
          }
        />
        <Row label="주제" value={a.event_summary} />
        <Row label="특기사항" value={a.special_notes} />
        <Row
          label="의뢰비용"
          value={a.fee_amount !== null ? formatKrw(a.fee_amount) : null}
        />
        <Row label="수락일시" value={kst(a.accepted_at)} />

        {(paymentLabel || a.account_last4 || a.payment_due_note || a.submission_docs) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>지급 정보</Text>
            <Row label="소득구분" value={paymentLabel} />
            <Row
              label="입금계좌"
              value={
                a.account_last4
                  ? [a.bank_name, `****${a.account_last4}`, a.account_holder]
                      .filter(Boolean)
                      .join(" · ")
                  : null
              }
            />
            <Row label="입금예정" value={a.payment_due_note} />
            <Row label="제출서류" value={a.submission_docs} />
          </View>
        )}

        {a.guide_note && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>안내 사항</Text>
            <Text style={styles.note}>{a.guide_note}</Text>
          </View>
        )}

        {a.map_url && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>찾아오시는 길</Text>
            <Text style={styles.note}>{a.map_url}</Text>
          </View>
        )}

        <View style={styles.declaration}>
          {a.signed_via === "manual" ? (
            <Text>
              본 건은 담당자가 전화 등으로 수락 의사를 직접 확인한 뒤 수동
              처리한 건입니다. 전자서명은 포함되어 있지 않습니다.
            </Text>
          ) : (
            <Text>
              본인은 위 내용을 확인하였으며, 해당 조건으로 참여를 수락합니다.
              {a.signed_at ? ` (전자서명 확인 ${kst(a.signed_at)})` : ""}
            </Text>
          )}
        </View>

        <View style={styles.signRow}>
          {view.signatureUrl && (
            <View style={styles.signBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image에는 alt가 없다 */}
              <Image style={styles.signImage} src={view.signatureUrl} />
              <Text style={styles.signCaption}>서명</Text>
            </View>
          )}
          {view.sealUrl && (
            <View style={styles.signBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image에는 alt가 없다 */}
              <Image style={styles.signImage} src={view.sealUrl} />
              <Text style={styles.signCaption}>날인</Text>
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          본 문서는 캐스트로그에서 전자적으로 생성되었습니다 · {a.tenant_name} ·
          {" "}
          {new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 출력
        </Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
