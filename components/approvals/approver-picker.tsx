"use client";

/**
 * 결재라인 직접 지정 (기획 확정 2026-08-30 — 18번, 개정 30번).
 * 후보는 **상신자보다 높은 직급**만 내려온다(서버도 강제). 체크한 순서가
 * 결재 순서고, 선택과 무관하게 **상무이사 → 대표는 고정(필수)** 으로 라인
 * 끝에 자동 연결된다.
 */
export type ApproverOption = {
  id: string;
  name: string;
  gradeLabel: string;
};

export function ApproverPicker({
  options,
  selected,
  onChange,
  disabled = false,
  emptyHint = "비워 두면 고정 결재선만으로 상신됩니다.",
  relayOn = false,
}: {
  options: ApproverOption[];
  /** 선택 순서 = 결재 순서 */
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** '비워 두면' 동작 안내 — 릴레이 켠 테넌트 등 흐름별로 실제 동작과 일치시킨다 */
  emptyHint?: string;
  /**
   * 상급자 릴레이(27번) 활성 — 무선택이면 고정 인물이 아니라 직급 단계로
   * 올라가므로 "마지막은 상무이사 → 대표 고정" 문구를 그대로 쓰면 틀린다
   */
  relayOn?: boolean;
}) {
  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((v) => v !== id)
        : [...selected, id]
    );
  };

  return (
    <div className="rounded-md border bg-secondary/30 p-3">
      <p className="mb-1 text-xs font-semibold">결재라인 직접 지정</p>
      <p className="mb-2 text-[11px] leading-tight text-muted-foreground">
        상신자보다 높은 직급의 결재자(PL·PM 등)를 체크한 순서대로 넣을 수
        있습니다.{" "}
        {relayOn ? (
          <>
            결재자를 고르면 그 뒤에{" "}
            <b className="text-foreground">상무이사 → 대표 (고정)</b>가
            붙고, 비워 두면 직급 단계(상급자 릴레이)로 올라갑니다.
          </>
        ) : (
          <>
            선택과 무관하게 마지막은{" "}
            <b className="text-foreground">상무이사 → 대표 (고정)</b>로 자동
            연결됩니다.
          </>
        )}{" "}
        {emptyHint}
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          중간에 넣을 상위 직급 결재자가 없습니다. {emptyHint}
        </p>
      ) : (
        <ul className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
          {options.map((o) => {
            const order = selected.indexOf(o.id);
            return (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/60">
                  <input
                    type="checkbox"
                    checked={order >= 0}
                    disabled={disabled}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="min-w-0 truncate">
                    {o.name}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {o.gradeLabel}
                    </span>
                  </span>
                  {order >= 0 && (
                    <span className="ml-auto rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {order + 1}차
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
