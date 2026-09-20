"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  deleteReviewItem,
  saveProjectReview,
  saveReviewItem,
  type ProjectReviewInput,
} from "./review-actions";

/** 프로젝트·배정·세션에서 자동으로 채우는 값 — 서버가 만든다 */
export type ReviewAuto = {
  code: string | null;
  name: string;
  clientName: string | null;
  budgetAmount: number | null;
  plName: string | null;
  pmName: string | null;
  deputyPmNames: string[];
  contractPeriod: string;
  eventDates: string;
  venue: string;
};

/** 저장된 요약표 (project_reviews) — null이면 아직 등록 전 */
export type ReviewSaved = Omit<ProjectReviewInput, "projectId">;

export type ReviewItemRow = {
  id: string;
  section: "expert" | "ops";
  sortOrder: number;
  subject: string;
  expertId: string | null;
  form: string | null;
  body: string;
};

/** 계약 성립 전문가 — 평가 행을 자동으로 놓는다 */
export type ReviewExpertAuto = {
  expertId: string;
  name: string;
  /** 참여 형태 자동값 (역할 유형 + 세션명) */
  form: string;
  /** 섭외 확정 탭 평가의견이 있으면 처음 내용으로 */
  hint: string | null;
};

const OPS_PRESETS = ["발주처 담당자", "대관처(행사장)", "참여인원", "기타사항"];

const REGISTER_CLASS = "h-7 px-2 text-[11px] bg-indigo-600 text-white hover:bg-indigo-700";
const EDIT_CLASS = "h-7 px-2 text-[11px] border-indigo-300 text-indigo-800 hover:bg-indigo-50";

function formatWon(n: number | null): string {
  return n === null ? "미기입" : `${n.toLocaleString("ko-KR")}원`;
}

function Dash({ text }: { text: string | null | undefined }) {
  return text ? <>{text}</> : <span className="text-muted-foreground">미기입</span>;
}

/** 두 값 중 하나를 고르는 체크 단추 (수의/입찰, 여/부) */
function ChoiceButtons<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex gap-1">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? null : o.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-default",
              on
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
            )}
          >
            {on ? "■ " : "□ "}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** ■ 완료 체크 */
function DoneCheck({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  id: string;
}) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className={cn("font-semibold", checked ? "text-indigo-700" : "text-neutral-500")}>
        {checked ? "■ 완료" : "□ 미완료"}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// 1. 완료 사업 결과 요약표
// ---------------------------------------------------------------------------
function SummarySection({
  projectId,
  auto,
  saved,
  canEdit,
}: {
  projectId: string;
  auto: ReviewAuto;
  saved: ReviewSaved | null;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [registered, setRegistered] = useState(saved !== null);
  const [editing, setEditing] = useState(saved === null);
  const [form, setForm] = useState<ReviewSaved>(
    saved ?? {
      contractType: null,
      recruitDone: null,
      recruitNote: null,
      depositDone: false,
      formTransferDone: false,
      formTransferNote: null,
      clientContact: null,
      eventDatesText: null,
      venueText: null,
    }
  );
  const editable = canEdit && editing && !pending;

  function patch(p: Partial<ReviewSaved>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function submit() {
    startTransition(async () => {
      const r = await saveProjectReview({ projectId, ...form });
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      setRegistered(true);
      setEditing(false);
      toast({ description: "요약표를 등록했습니다." });
    });
  }

  const th = "w-28 border bg-neutral-50 px-2 py-2 text-left text-xs font-semibold align-top";
  const th2 = "w-40 border bg-neutral-50/60 px-2 py-2 text-left text-xs font-semibold align-top";
  const td = "border px-2 py-2 text-sm align-top";
  const textInput = (value: string | null, key: keyof ReviewSaved, placeholder: string) =>
    editable ? (
      <Input
        value={value ?? ""}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<ReviewSaved>)}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    ) : value ? (
      <span>{value}</span>
    ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">1. 완료 사업 결과 요약표</CardTitle>
        {canEdit &&
          (editing ? (
            <Button type="button" size="sm" className={REGISTER_CLASS} onClick={submit} disabled={pending}>
              <Check className="mr-0.5 h-3 w-3" aria-hidden />
              등록
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className={EDIT_CLASS} onClick={() => setEditing(true)}>
              <Pencil className="mr-0.5 h-3 w-3" aria-hidden />
              수정
            </Button>
          ))}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr>
                <th colSpan={2} className="border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold">
                  구분
                </th>
                <th className="border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold">내용</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th rowSpan={5} className={th}>
                  사업 개요
                </th>
                <th className={th2}>사업코드/사업명</th>
                <td className={td}>
                  <Dash text={auto.code} /> / {auto.name}
                </td>
              </tr>
              <tr>
                <th className={th2}>발주처/담당자</th>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1">
                    <Dash text={auto.clientName} />
                    <span>/</span>
                    <div className="min-w-[10rem] flex-1">
                      {textInput(form.clientContact, "clientContact", "담당자 (예: 창업사업화팀 홍길동 주임)") ?? (
                        <span className="text-muted-foreground">담당자 미기입</span>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <th className={th2}>계약 처리 구분(수의/입찰)</th>
                <td className={td}>
                  <ChoiceButtons
                    value={form.contractType}
                    options={[
                      { value: "private", label: "수의 계약" },
                      { value: "bid", label: "입찰" },
                    ]}
                    onChange={(v) => patch({ contractType: v })}
                    disabled={!editable}
                  />
                </td>
              </tr>
              <tr>
                <th className={th2}>사업비</th>
                <td className={td}>{formatWon(auto.budgetAmount)}</td>
              </tr>
              <tr>
                <th className={th2}>PL/PM/부PM</th>
                <td className={td}>
                  {auto.plName ?? "-"} / {auto.pmName ?? "-"} /{" "}
                  {auto.deputyPmNames.length > 0 ? auto.deputyPmNames.join(", ") : "-"}
                </td>
              </tr>
              <tr>
                <th rowSpan={2} className={th}>
                  기간 및 장소
                </th>
                <th className={th2}>계약기간/행사일</th>
                <td className={td}>
                  <div className="space-y-1">
                    <div>
                      {auto.contractPeriod || <span className="text-muted-foreground">기간 미기입</span>}
                      {" / "}
                      {form.eventDatesText ?? auto.eventDates ?? ""}
                      {!form.eventDatesText && !auto.eventDates && (
                        <span className="text-muted-foreground">행사일 미기입</span>
                      )}
                    </div>
                    {editable && (
                      <Input
                        value={form.eventDatesText ?? ""}
                        onChange={(e) => patch({ eventDatesText: e.target.value })}
                        placeholder={auto.eventDates ? `세션 일정 자동: ${auto.eventDates} (다르게 적으려면 입력)` : "행사일을 적어 주세요"}
                        className="h-7 text-xs"
                      />
                    )}
                  </div>
                </td>
              </tr>
              <tr>
                <th className={th2}>행사 장소</th>
                <td className={td}>
                  <div className="space-y-1">
                    <div>
                      {form.venueText ?? auto.venue ?? ""}
                      {!form.venueText && !auto.venue && (
                        <span className="text-muted-foreground">장소 미기입</span>
                      )}
                    </div>
                    {editable && (
                      <Input
                        value={form.venueText ?? ""}
                        onChange={(e) => patch({ venueText: e.target.value })}
                        placeholder={auto.venue ? `세션 장소 자동: ${auto.venue} (다르게 적으려면 입력)` : "행사 장소를 적어 주세요"}
                        className="h-7 text-xs"
                      />
                    )}
                  </div>
                </td>
              </tr>
              <tr>
                <th className={th}>모집/홍보</th>
                <th className={th2}>진행여부</th>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-2">
                    <ChoiceButtons
                      value={form.recruitDone === null ? null : form.recruitDone ? "yes" : "no"}
                      options={[
                        { value: "yes", label: "여" },
                        { value: "no", label: "부" },
                      ]}
                      onChange={(v) => patch({ recruitDone: v === null ? null : v === "yes" })}
                      disabled={!editable}
                    />
                    <div className="min-w-[12rem] flex-1">
                      {textInput(form.recruitNote, "recruitNote", "부연 (예: 발주처에서 모집 진행)")}
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <th colSpan={2} className={th2}>
                  사업비 입금 완료여부
                </th>
                <td className={td}>
                  <DoneCheck
                    id="review-deposit"
                    checked={form.depositDone}
                    onChange={(v) => patch({ depositDone: v })}
                    disabled={!editable}
                  />
                </td>
              </tr>
              <tr>
                <th colSpan={2} className={th2}>
                  모아폼/구글폼 소유권 이전 여부
                </th>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-2">
                    <DoneCheck
                      id="review-form-transfer"
                      checked={form.formTransferDone}
                      onChange={(v) => patch({ formTransferDone: v })}
                      disabled={!editable}
                    />
                    <div className="min-w-[12rem] flex-1">
                      {textInput(form.formTransferNote, "formTransferNote", "부연 (예: ○○○ 상무 계정)")}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {!registered && !canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">아직 등록된 요약표가 없습니다.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2·3. 행 단위 구간 (전문가 평가 · 운영 특이사항)
// ---------------------------------------------------------------------------
type RowState = {
  /** 화면 키 (저장 전에는 임시값) */
  key: string;
  id: string | null;
  expertId: string | null;
  subject: string;
  form: string;
  body: string;
  editing: boolean;
  /** 자동 행(전문가·기본 구분)은 삭제 대신 비워 둔다 */
  auto: boolean;
};

function RowsSection({
  projectId,
  section,
  title,
  note,
  subjectLabel,
  withForm,
  initialRows,
  canEdit,
}: {
  projectId: string;
  section: "expert" | "ops";
  title: string;
  note?: string;
  subjectLabel: string;
  /** 참여 형태 열 (전문가 평가만) */
  withForm: boolean;
  initialRows: RowState[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RowState[]>(initialRows);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function patchRow(key: string, p: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        id: null,
        expertId: null,
        subject: "",
        form: "",
        body: "",
        editing: true,
        auto: false,
      },
    ]);
  }

  function register(row: RowState, index: number) {
    if (!row.subject.trim() && !row.expertId) {
      toast({ variant: "destructive", description: `${subjectLabel}을(를) 적어 주세요.` });
      return;
    }
    setBusyKey(row.key);
    startTransition(async () => {
      const r = await saveReviewItem({
        id: row.id,
        projectId,
        section,
        sortOrder: index,
        subject: row.subject.trim(),
        expertId: row.expertId,
        form: withForm ? row.form : null,
        body: row.body.trim(),
      });
      setBusyKey(null);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      patchRow(row.key, { id: r.id, editing: false, body: row.body.trim(), subject: row.subject.trim() });
      toast({ description: row.id ? "수정했습니다." : "등록했습니다." });
    });
  }

  function remove(row: RowState) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    if (!window.confirm("이 줄을 삭제할까요? 되돌릴 수 없습니다.")) return;
    setBusyKey(row.key);
    startTransition(async () => {
      const r = await deleteReviewItem(row.id as string);
      setBusyKey(null);
      if (!r.ok) {
        toast({ variant: "destructive", description: r.error });
        return;
      }
      setRows((prev) => prev.filter((k) => k.key !== row.key));
      toast({ description: "삭제했습니다." });
    });
  }

  const th = "border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold";
  const td = "border px-2 py-1.5 text-sm align-top";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" className={EDIT_CLASS} onClick={addRow} title="줄 추가">
            <Plus className="mr-0.5 h-3 w-3" aria-hidden />
            줄 추가
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr>
                <th className={cn(th, "w-36")}>{subjectLabel}</th>
                {withForm && <th className={cn(th, "w-40")}>참여 형태</th>}
                <th className={th}>{withForm ? "평가 내용" : "내용"}</th>
                {canEdit && <th className={cn(th, "w-28")}>처리</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={withForm ? 4 : 3} className="border px-2 py-4 text-center text-xs text-muted-foreground">
                    아직 줄이 없습니다. {canEdit ? "'줄 추가'로 시작하세요." : ""}
                  </td>
                </tr>
              )}
              {rows.map((row, index) => {
                const editable = canEdit && row.editing && busyKey !== row.key;
                return (
                  <tr key={row.key} className={cn(row.id === null && "bg-amber-50/40")}>
                    <td className={td}>
                      {row.expertId || !editable ? (
                        <span className="font-semibold">{row.subject || <span className="text-muted-foreground">-</span>}</span>
                      ) : (
                        <Input
                          value={row.subject}
                          onChange={(e) => patchRow(row.key, { subject: e.target.value })}
                          placeholder={subjectLabel}
                          className="h-7 text-xs"
                        />
                      )}
                    </td>
                    {withForm && (
                      <td className={td}>
                        {editable ? (
                          <Input
                            value={row.form}
                            onChange={(e) => patchRow(row.key, { form: e.target.value })}
                            placeholder="강의 (주제)"
                            className="h-7 text-xs"
                          />
                        ) : (
                          <span className="whitespace-pre-wrap text-xs">{row.form || "-"}</span>
                        )}
                      </td>
                    )}
                    <td className={td}>
                      {editable ? (
                        <Textarea
                          value={row.body}
                          onChange={(e) => patchRow(row.key, { body: e.target.value })}
                          placeholder={withForm ? "특이사항 없음." : "내용을 적어 주세요."}
                          className="min-h-[72px] text-sm"
                          rows={3}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap">
                          {row.body || <span className="text-muted-foreground">미기입</span>}
                        </div>
                      )}
                    </td>
                    {canEdit && (
                      <td className={cn(td, "text-center")}>
                        <div className="flex flex-col items-center gap-1">
                          {row.editing ? (
                            <Button
                              type="button"
                              size="sm"
                              className={REGISTER_CLASS}
                              onClick={() => register(row, index)}
                              disabled={busyKey === row.key}
                            >
                              <Check className="mr-0.5 h-3 w-3" aria-hidden />
                              등록
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className={EDIT_CLASS}
                              onClick={() => patchRow(row.key, { editing: true })}
                              disabled={busyKey === row.key}
                            >
                              <Pencil className="mr-0.5 h-3 w-3" aria-hidden />
                              수정
                            </Button>
                          )}
                          {!row.auto && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                              onClick={() => remove(row)}
                              disabled={busyKey === row.key}
                              title={row.id ? "삭제" : "취소"}
                            >
                              <Trash2 className="mr-0.5 h-3 w-3" aria-hidden />
                              {row.id ? "삭제" : "취소"}
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 탭 본체
// ---------------------------------------------------------------------------
export function ProjectReviewTab({
  projectId,
  auto,
  saved,
  items,
  experts,
  hasExperts,
  canEdit,
}: {
  projectId: string;
  auto: ReviewAuto;
  saved: ReviewSaved | null;
  items: ReviewItemRow[];
  experts: ReviewExpertAuto[];
  hasExperts: boolean;
  canEdit: boolean;
}) {
  // 전문가 평가 행: 저장된 행(전문가 연결·직접 추가) + 아직 등록 안 된 계약 성립 전문가
  const savedExpertItems = items.filter((i) => i.section === "expert");
  const savedByExpert = new Map(
    savedExpertItems.filter((i) => i.expertId).map((i) => [i.expertId as string, i])
  );
  const expertRows: RowState[] = [
    ...experts.map((e) => {
      const s = savedByExpert.get(e.expertId);
      return s
        ? { key: s.id, id: s.id, expertId: e.expertId, subject: s.subject || e.name, form: s.form ?? "", body: s.body, editing: false, auto: true }
        : { key: `auto-${e.expertId}`, id: null, expertId: e.expertId, subject: e.name, form: e.form, body: e.hint ?? "", editing: true, auto: true };
    }),
    // 전문가 연결이 끊긴(더는 계약 성립이 아닌) 저장 행도 남긴다 — 기록이다
    ...savedExpertItems
      .filter((i) => !i.expertId || !experts.some((e) => e.expertId === i.expertId))
      .map((i) => ({ key: i.id, id: i.id, expertId: i.expertId, subject: i.subject, form: i.form ?? "", body: i.body, editing: false, auto: Boolean(i.expertId) })),
  ];

  const savedOps = items.filter((i) => i.section === "ops");
  const opsRows: RowState[] =
    savedOps.length > 0
      ? savedOps.map((i) => ({ key: i.id, id: i.id, expertId: null, subject: i.subject, form: "", body: i.body, editing: false, auto: false }))
      : OPS_PRESETS.map((label, n) => ({ key: `preset-${n}`, id: null, expertId: null, subject: label, form: "", body: "", editing: true, auto: false }));

  return (
    <div className="space-y-5">
      <SummarySection projectId={projectId} auto={auto} saved={saved} canEdit={canEdit} />
      {hasExperts && (
        <RowsSection
          projectId={projectId}
          section="expert"
          title="2. 전문가(강사) 평가 (담당 PM 작성)"
          note="※ 평가항목: 준비도(자료 등), 전달력 및 집중도, 적합성(대상/주제/목적 등), 기타사항 등. 계약이 성립한 전문가는 자동으로 줄이 놓입니다."
          subjectLabel="참여 전문가명"
          withForm
          initialRows={expertRows}
          canEdit={canEdit}
        />
      )}
      <RowsSection
        projectId={projectId}
        section="ops"
        title={`${hasExperts ? "3" : "2"}. 프로젝트 운영 및 관리 특이사항`}
        subjectLabel="구분"
        withForm={false}
        initialRows={opsRows}
        canEdit={canEdit}
      />
    </div>
  );
}
