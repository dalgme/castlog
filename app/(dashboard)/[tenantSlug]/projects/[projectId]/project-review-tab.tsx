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
  /** D-Day 기준일 표기 — 세션이 하나도 없을 때의 행사일 폴백 */
  ddayDate: string;
  /** 행사일 표의 칸 — 세션마다 하나 (가로 3칸, 넘치면 다음 행) */
  sessions: { label: string; when: string }[];
  /** 계약 처리 구분 표기 — 기본정보(생성·수정)에서 정한다. null = 미정 */
  contractType: string | null;
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
  authorName: string | null;
  createdAt: string;
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

/** 운영·관리 특이사항의 고정 영역 — 영역마다 줄을 댓글처럼 쌓는다 (기획 2026-09-21) */
const OPS_AREAS = ["발주처 담당자", "대관처(행사장)", "참여인원", "기타사항"];

const REGISTER_CLASS = "h-7 px-2 text-[11px] bg-indigo-600 text-white hover:bg-indigo-700";
const EDIT_CLASS = "h-7 px-2 text-[11px] border-indigo-300 text-indigo-800 hover:bg-indigo-50";

function formatWon(n: number | null): string {
  return n === null ? "미기입" : `${n.toLocaleString("ko-KR")}원`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function Dash({ text }: { text: string | null | undefined }) {
  return text ? <>{text}</> : <span className="text-muted-foreground">미기입</span>;
}

/** 두 값 중 하나를 고르는 체크 단추 (여/부) */
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

/** 행사일 — 세션을 가로 3칸 표에 놓고 넘치면 다음 행 (기획 2026-09-21) */
function SessionGrid({ sessions }: { sessions: { label: string; when: string }[] }) {
  const rows: { label: string; when: string }[][] = [];
  for (let i = 0; i < sessions.length; i += 3) rows.push(sessions.slice(i, i + 3));
  return (
    <table className="w-full table-fixed border-collapse">
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {[0, 1, 2].map((c) => {
              const cell = row[c];
              return (
                <td key={c} className="w-1/3 border bg-white px-2 py-1.5 align-top text-xs">
                  {cell ? (
                    <>
                      <div className="font-semibold">{cell.label}</div>
                      <div className="text-muted-foreground">{cell.when}</div>
                    </>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
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
                  {auto.contractType ? (
                    <span className="font-semibold">■ {auto.contractType}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      미정 — 기본설정 탭의 「기본정보 수정」에서 수의 계약/입찰을 고르면 여기에 표시됩니다.
                    </span>
                  )}
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
                <td className={cn(td, "space-y-1.5")}>
                  <div>
                    <span className="text-xs text-muted-foreground">계약기간 </span>
                    {auto.contractPeriod || <span className="text-muted-foreground">미기입</span>}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">행사일 (세션별)</span>
                    {auto.sessions.length > 0 ? (
                      <div className="mt-1">
                        <SessionGrid sessions={auto.sessions} />
                      </div>
                    ) : (
                      <span className="ml-1 text-muted-foreground">
                        {auto.ddayDate || "등록된 세션이 없습니다 (기본설정 탭에서 세션을 만들면 자동으로 채워집니다)."}
                      </span>
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
// 2. 전문가 평가 — 행 단위
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
  /** 자동 행(전문가)은 삭제 대신 비워 둔다 */
  auto: boolean;
  authorName: string | null;
  createdAt: string | null;
};

function useRowActions(projectId: string, section: "expert" | "ops", withForm: boolean) {
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function register(
    row: RowState,
    index: number,
    onSaved: (id: string) => void
  ) {
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
      onSaved(r.id);
      toast({ description: row.id ? "수정했습니다." : "등록했습니다." });
    });
  }

  function remove(row: RowState, onRemoved: () => void) {
    if (!row.id) {
      onRemoved();
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
      onRemoved();
      toast({ description: "삭제했습니다." });
    });
  }

  return { busyKey, register, remove, toast };
}

function RowButtons({
  row,
  busy,
  canDelete,
  onRegister,
  onEdit,
  onRemove,
}: {
  row: RowState;
  busy: boolean;
  canDelete: boolean;
  onRegister: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {row.editing ? (
        <Button type="button" size="sm" className={REGISTER_CLASS} onClick={onRegister} disabled={busy}>
          <Check className="mr-0.5 h-3 w-3" aria-hidden />
          등록
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" className={EDIT_CLASS} onClick={onEdit} disabled={busy}>
          <Pencil className="mr-0.5 h-3 w-3" aria-hidden />
          수정
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={busy}
          title={row.id ? "삭제" : "취소"}
        >
          <Trash2 className="mr-0.5 h-3 w-3" aria-hidden />
          {row.id ? "삭제" : "취소"}
        </Button>
      )}
    </div>
  );
}

function ExpertSection({
  projectId,
  initialRows,
  canEdit,
}: {
  projectId: string;
  initialRows: RowState[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<RowState[]>(initialRows);
  const { busyKey, register, remove, toast } = useRowActions(projectId, "expert", true);

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
        authorName: null,
        createdAt: null,
      },
    ]);
  }

  const th = "border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold";
  const td = "border px-2 py-1.5 text-sm align-top";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm">2. 전문가(강사) 평가 (담당 PM 작성)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            ※ 평가항목: 준비도(자료 등), 전달력 및 집중도, 적합성(대상/주제/목적 등), 기타사항 등. 계약이 성립한 전문가는 자동으로 줄이 놓입니다.
          </p>
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
                <th className={cn(th, "w-36")}>참여 전문가명</th>
                <th className={cn(th, "w-40")}>참여 형태</th>
                <th className={th}>평가 내용</th>
                {canEdit && <th className={cn(th, "w-28")}>처리</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="border px-2 py-4 text-center text-xs text-muted-foreground">
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
                          placeholder="참여 전문가명"
                          className="h-7 text-xs"
                        />
                      )}
                    </td>
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
                    <td className={td}>
                      {editable ? (
                        <Textarea
                          value={row.body}
                          onChange={(e) => patchRow(row.key, { body: e.target.value })}
                          placeholder="특이사항 없음."
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
                        <RowButtons
                          row={row}
                          busy={busyKey === row.key}
                          canDelete={!row.auto}
                          onRegister={() => {
                            if (!row.subject.trim() && !row.expertId) {
                              toast({ variant: "destructive", description: "참여 전문가명을 적어 주세요." });
                              return;
                            }
                            register(row, index, (id) =>
                              patchRow(row.key, { id, editing: false, body: row.body.trim(), subject: row.subject.trim() })
                            );
                          }}
                          onEdit={() => patchRow(row.key, { editing: true })}
                          onRemove={() => remove(row, () => setRows((prev) => prev.filter((r) => r.key !== row.key)))}
                        />
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
// 3. 운영·관리 특이사항 — 영역마다 줄을 댓글처럼 쌓는다 (기획 2026-09-21)
// ---------------------------------------------------------------------------
function OpsSection({
  projectId,
  title,
  initialRows,
  canEdit,
}: {
  projectId: string;
  title: string;
  initialRows: RowState[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<RowState[]>(initialRows);
  const { busyKey, register, remove, toast } = useRowActions(projectId, "ops", false);

  function patchRow(key: string, p: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function addLine(area: string) {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        id: null,
        expertId: null,
        subject: area,
        form: "",
        body: "",
        editing: true,
        auto: false,
        authorName: null,
        createdAt: null,
      },
    ]);
  }

  // 영역 = 고정 4개 + 저장돼 있는 다른 구분(옛 저장분·직접 적은 구분)
  const areas = [
    ...OPS_AREAS,
    ...Array.from(new Set(rows.map((r) => r.subject))).filter((s) => !OPS_AREAS.includes(s)),
  ];

  const th = "border bg-neutral-100 px-2 py-1.5 text-center text-xs font-semibold";
  const td = "border px-2 py-1.5 text-sm align-top";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          영역마다 「줄 추가」로 내용을 계속 쌓습니다. 줄마다 등록하면 작성자와 시각이 남고, 「수정」으로 고칠 수 있습니다.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr>
                <th className={cn(th, "w-36")}>구분</th>
                <th className={th}>내용</th>
                {canEdit && <th className={cn(th, "w-28")}>처리</th>}
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => {
                const lines = rows.filter((r) => r.subject === area);
                const span = Math.max(1, lines.length) + (canEdit ? 1 : 0);
                return (
                  <FragmentRows key={area}>
                    {lines.length === 0 && (
                      <tr>
                        <th rowSpan={span} className={cn(td, "w-36 bg-neutral-50 text-left text-xs font-semibold")}>
                          {area}
                        </th>
                        <td className={cn(td, "text-xs text-muted-foreground")} colSpan={canEdit ? 2 : 1}>
                          아직 적은 내용이 없습니다.
                        </td>
                      </tr>
                    )}
                    {lines.map((row, i) => {
                      const editable = canEdit && row.editing && busyKey !== row.key;
                      const index = rows.findIndex((r) => r.key === row.key);
                      return (
                        <tr key={row.key} className={cn(row.id === null && "bg-amber-50/40")}>
                          {i === 0 && (
                            <th rowSpan={span} className={cn(td, "w-36 bg-neutral-50 text-left text-xs font-semibold")}>
                              {area}
                            </th>
                          )}
                          <td className={td}>
                            {editable ? (
                              <Textarea
                                value={row.body}
                                onChange={(e) => patchRow(row.key, { body: e.target.value })}
                                placeholder="내용을 적어 주세요."
                                className="min-h-[60px] text-sm"
                                rows={2}
                                autoFocus={row.id === null}
                              />
                            ) : (
                              <div>
                                <div className="whitespace-pre-wrap">
                                  {row.body || <span className="text-muted-foreground">미기입</span>}
                                </div>
                                {(row.authorName || row.createdAt) && (
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                                    {row.authorName ?? ""}
                                    {row.authorName && row.createdAt ? " · " : ""}
                                    {row.createdAt ? formatWhen(row.createdAt) : ""}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          {canEdit && (
                            <td className={cn(td, "text-center")}>
                              <RowButtons
                                row={row}
                                busy={busyKey === row.key}
                                canDelete
                                onRegister={() => {
                                  if (!row.body.trim()) {
                                    toast({ variant: "destructive", description: "내용을 적어 주세요." });
                                    return;
                                  }
                                  register(row, index, (id) =>
                                    patchRow(row.key, {
                                      id,
                                      editing: false,
                                      body: row.body.trim(),
                                      createdAt: row.createdAt ?? new Date().toISOString(),
                                    })
                                  );
                                }}
                                onEdit={() => patchRow(row.key, { editing: true })}
                                onRemove={() => remove(row, () => setRows((prev) => prev.filter((r) => r.key !== row.key)))}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {canEdit && (
                      <tr>
                        <td className={cn(td, "py-1")} colSpan={2}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px] text-indigo-700 hover:bg-indigo-50"
                            onClick={() => addLine(area)}
                            disabled={lines.some((l) => l.id === null)}
                            title={lines.some((l) => l.id === null) ? "먼저 위 줄을 등록하세요" : "줄 추가"}
                          >
                            <Plus className="mr-0.5 h-3 w-3" aria-hidden />
                            줄 추가
                          </Button>
                        </td>
                      </tr>
                    )}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** tbody 안에서 여러 tr을 묶는 프래그먼트 (key용) */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
  const toRow = (i: ReviewItemRow, auto: boolean): RowState => ({
    key: i.id,
    id: i.id,
    expertId: i.expertId,
    subject: i.subject,
    form: i.form ?? "",
    body: i.body,
    editing: false,
    auto,
    authorName: i.authorName,
    createdAt: i.createdAt,
  });

  // 전문가 평가 행: 저장된 행(전문가 연결·직접 추가) + 아직 등록 안 된 계약 성립 전문가
  const savedExpertItems = items.filter((i) => i.section === "expert");
  const savedByExpert = new Map(
    savedExpertItems.filter((i) => i.expertId).map((i) => [i.expertId as string, i])
  );
  const expertRows: RowState[] = [
    ...experts.map((e) => {
      const s = savedByExpert.get(e.expertId);
      return s
        ? { ...toRow(s, true), subject: s.subject || e.name }
        : {
            key: `auto-${e.expertId}`,
            id: null,
            expertId: e.expertId,
            subject: e.name,
            form: e.form,
            body: e.hint ?? "",
            editing: true,
            auto: true,
            authorName: null,
            createdAt: null,
          };
    }),
    // 전문가 연결이 끊긴(더는 계약 성립이 아닌) 저장 행도 남긴다 — 기록이다
    ...savedExpertItems
      .filter((i) => !i.expertId || !experts.some((e) => e.expertId === i.expertId))
      .map((i) => toRow(i, Boolean(i.expertId))),
  ];

  const opsRows: RowState[] = items
    .filter((i) => i.section === "ops")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((i) => toRow(i, false));

  return (
    <div className="space-y-5">
      <SummarySection projectId={projectId} auto={auto} saved={saved} canEdit={canEdit} />
      {hasExperts && <ExpertSection projectId={projectId} initialRows={expertRows} canEdit={canEdit} />}
      <OpsSection
        projectId={projectId}
        title={`${hasExperts ? "3" : "2"}. 프로젝트 운영 및 관리 특이사항`}
        initialRows={opsRows}
        canEdit={canEdit}
      />
    </div>
  );
}
