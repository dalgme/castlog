"use client";

/**
 * 결재라인 직접 지정 (기획 확정 2026-08-30 — 18번).
 * 체크한 순서가 결재 순서다 — 각 항목에 "N차" 뱃지로 보여 준다.
 * 비워 두면 전결규정(없으면 직급 체계)이 적용된다.
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
}: {
  options: ApproverOption[];
  /** 선택 순서 = 결재 순서 */
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
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
      <p className="mb-1 text-xs font-semibold">결재라인 직접 지정 (선택)</p>
      <p className="mb-2 text-[11px] leading-tight text-muted-foreground">
        체크한 순서대로 결재가 올라갑니다 — PL·PM 등 필요한 결재자를 넣을 수
        있습니다. 비워 두면 전결규정(없으면 직급 체계 — 마지막은 대표)이
        적용됩니다.
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          지정할 수 있는 직원이 없습니다.
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
