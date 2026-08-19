-- ============================================================================
-- 본인 정보 수정 (이름·연락처) — 대리 이하도 자기 '설정'이 있어야 한다
--
-- 지금까지 users에 쓰기 정책은 staff 스코프 권한자 전용뿐이라, 사원이 자기
-- 휴대폰 번호 하나 고치려면 관리자에게 부탁해야 했다. 본인 행에 한해 열되,
-- **권한에 해당하는 컬럼은 절대 못 건드리게 트리거로 막는다.**
-- (정책만으로는 컬럼 단위 제한이 안 되므로 트리거가 실질 방어선이다)
-- ============================================================================

create or replace function app.block_self_privilege_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 본인이 자기 행을 고치는 경우에만 검사한다. 인사권자(staff 스코프)는 통과.
  if auth.uid() is null or auth.uid() <> new.id then
    return new;
  end if;
  if app.has_admin_scope('staff') then
    return new;
  end if;

  if new.grade is distinct from old.grade
     or new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.position_id is distinct from old.position_id
     or new.department is distinct from old.department then
    raise exception '본인 정보에서는 이름·연락처만 변경할 수 있습니다. 직급·부서·계정 상태는 인사 권한자가 변경합니다.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists z_block_self_privilege_change on public.users;
create trigger z_block_self_privilege_change
  before update on public.users
  for each row execute function app.block_self_privilege_change();

-- 본인 행 수정 허용 (permissive — 기존 users_write와 OR로 결합).
-- 실제로 무엇을 바꿀 수 있는지는 위 트리거가 정한다.
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update
  using (id = auth.uid() and tenant_id = app.tenant_id())
  with check (id = auth.uid() and tenant_id = app.tenant_id());

comment on function app.block_self_privilege_change() is
  '본인 정보 수정 시 권한 관련 컬럼 변경을 차단한다. 인사 권한자(staff 스코프)는 예외.';
