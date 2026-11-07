-- 임직원 쪽지 (기획 지시 2026-11-07) — 공통 기반
--
-- 같은 회사 임직원 사이에 보내는 쪽지. 보낼 때 받는 사람(여럿 가능)과 주제
-- (개설된 프로젝트 하나 또는 '기타사항')를 고른다. 관리는 날짜/시간순·프로젝트별·
-- 사람별로 본다. 받는 사람이 여럿이면 한 번 발송(batch_id)이 사람 수만큼 행이 된다 —
-- 읽음·숨김이 사람마다 다르기 때문이다.
-- 삭제 대신 숨김(sender_hidden_at / recipient_hidden_at) — §14-4.
-- 멱등: create if not exists / drop-and-create. 코드는 표 부재(42P01·PGRST205)를 '준비 중'으로 폴백한다.

create table if not exists public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- 한 번 발송(수신자 여럿) 묶음
  batch_id uuid not null default gen_random_uuid(),
  sender_user_id uuid not null references public.users (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  -- project = 개설된 프로젝트에 관한 쪽지 / other = 기타사항
  topic_kind text not null check (topic_kind in ('project', 'other')),
  -- 프로젝트가 지워지면 null — 쪽지 자체는 남긴다(앱은 '삭제된 프로젝트'로 표시)
  project_id uuid references public.projects (id) on delete set null,
  -- 기타사항일 때 짧은 제목(선택)
  topic_label text check (topic_label is null or length(topic_label) <= 60),
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,
  sender_hidden_at timestamptz,
  recipient_hidden_at timestamptz,
  is_practice boolean not null default false,
  created_at timestamptz not null default now(),
  constraint staff_notes_not_self check (sender_user_id <> recipient_user_id)
);

create index if not exists staff_notes_recipient_idx
  on public.staff_notes (tenant_id, recipient_user_id, created_at desc);
create index if not exists staff_notes_sender_idx
  on public.staff_notes (tenant_id, sender_user_id, created_at desc);
create index if not exists staff_notes_project_idx
  on public.staff_notes (tenant_id, project_id, created_at desc);
create index if not exists staff_notes_unread_idx
  on public.staff_notes (recipient_user_id) where read_at is null and recipient_hidden_at is null;

alter table public.staff_notes enable row level security;

-- 열람: 자사 임직원(전문가 제외) 중 보낸 사람 또는 받는 사람 본인만
drop policy if exists staff_notes_select on public.staff_notes;
create policy staff_notes_select on public.staff_notes
  for select using (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and auth.uid() in (sender_user_id, recipient_user_id)
  );

-- 보내기: 본인이 보낸 사람이어야 하고, 받는 사람은 같은 회사의 활성 임직원
drop policy if exists staff_notes_insert on public.staff_notes;
create policy staff_notes_insert on public.staff_notes
  for insert with check (
    tenant_id = app.tenant_id()
    and app.user_role() <> 'expert'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = recipient_user_id
        and u.tenant_id = app.tenant_id()
        and u.is_active
    )
  );

-- 고치기: 당사자만 — 바꿀 수 있는 칸은 read_at·숨김 시각뿐 (아래 트리거가 강제)
drop policy if exists staff_notes_update on public.staff_notes;
create policy staff_notes_update on public.staff_notes
  for update using (
    tenant_id = app.tenant_id()
    and auth.uid() in (sender_user_id, recipient_user_id)
  )
  with check (
    tenant_id = app.tenant_id()
    and auth.uid() in (sender_user_id, recipient_user_id)
  );

-- 연습모드 격리 — 자매 표들과 동일한 restrictive 정책
drop policy if exists staff_notes_practice on public.staff_notes;
create policy staff_notes_practice on public.staff_notes
  as restrictive for select using (is_practice = app.is_practice());

-- 본문·보낸이·받는이·주제는 보낸 뒤 바꿀 수 없다. 읽음은 받는 사람만, 숨김은 각자 자기 칸만.
create or replace function app.guard_staff_note_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.batch_id <> old.batch_id
     or new.sender_user_id <> old.sender_user_id
     or new.recipient_user_id <> old.recipient_user_id
     or new.topic_kind <> old.topic_kind
     or new.project_id is distinct from old.project_id
     or new.topic_label is distinct from old.topic_label
     or new.body <> old.body
     or new.is_practice <> old.is_practice
     or new.created_at <> old.created_at then
    raise exception 'staff_notes: 보낸 쪽지의 내용은 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  if new.read_at is distinct from old.read_at and auth.uid() is not null and auth.uid() <> old.recipient_user_id then
    raise exception 'staff_notes: 읽음 표시는 받는 사람만 할 수 있습니다' using errcode = 'check_violation';
  end if;
  if new.sender_hidden_at is distinct from old.sender_hidden_at and auth.uid() is not null and auth.uid() <> old.sender_user_id then
    raise exception 'staff_notes: 보낸 쪽지 숨김은 보낸 사람만 할 수 있습니다' using errcode = 'check_violation';
  end if;
  if new.recipient_hidden_at is distinct from old.recipient_hidden_at and auth.uid() is not null and auth.uid() <> old.recipient_user_id then
    raise exception 'staff_notes: 받은 쪽지 숨김은 받는 사람만 할 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_staff_note_update on public.staff_notes;
create trigger trg_guard_staff_note_update
  before update on public.staff_notes
  for each row execute function app.guard_staff_note_update();

comment on table public.staff_notes is
  '임직원 쪽지 — 받는 사람·주제(프로젝트/기타사항)를 골라 보낸다. 수신자별 1행(batch_id로 묶음). 삭제 대신 숨김 (기획 2026-11-07)';
