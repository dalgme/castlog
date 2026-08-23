-- ============================================================================
-- 프로젝트 담당 역할에 PL 추가 — PL / PM / 부PM / 담당 (기획 확정 2026-08-23)
--
--  * PL은 프로젝트당 1명, PM도 1명. 부PM·담당(member)은 인원 제한 없음.
--  * PL은 PM을 겸임할 수 있다. 배정은 '한 사람 = 한 행' 모델을 유지하므로
--    겸임은 별도 역할 값 'pl_pm'으로 표현한다 (PL 1명·PM 1명 제한에 모두 계상).
--  * 열람 범위는 여전히 '배정 여부'로만 결정된다 — 역할은 책임 표시 운영 정보.
-- ============================================================================

alter table public.project_assignments
  drop constraint if exists project_assignments_role_check;
alter table public.project_assignments
  add constraint project_assignments_role_check
  check (assignment_role in ('pl', 'pl_pm', 'pm', 'deputy_pm', 'member'));

-- 프로젝트당 PL 1명 (겸임 포함)
create unique index if not exists project_assignments_pl_idx
  on public.project_assignments (project_id)
  where assignment_role in ('pl', 'pl_pm');

-- 프로젝트당 PM 1명 (겸임 포함) — pm 단일 값 기준이던 기존 인덱스 교체
drop index if exists public.project_assignments_pm_idx;
create unique index if not exists project_assignments_pm_idx
  on public.project_assignments (project_id)
  where assignment_role in ('pm', 'pl_pm');

comment on column public.project_assignments.assignment_role is
  'pl(총괄) / pl_pm(PL·PM 겸임) / pm(책임) / deputy_pm(부책임) / member(담당). '
  '프로젝트당 PL 1명·PM 1명(겸임은 양쪽에 계상), 부PM·담당은 제한 없음.';
