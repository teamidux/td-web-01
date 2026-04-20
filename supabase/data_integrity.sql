-- Data integrity fixes — run once in Supabase SQL Editor
-- Address audit findings: lost updates, missing constraints, race conditions

-- ─────────────────────────────────────────────────────────────
-- 1. Atomic sold_count adjustment (กัน lost update race)
-- ─────────────────────────────────────────────────────────────
-- Before: API อ่าน current count → +1 → write = 2 concurrent calls ได้ +1 เดียว
-- After: DB ทำให้ atomic — 2 calls = +2 จริง
create or replace function adjust_sold_count(p_user_id uuid, p_delta int)
returns int language plpgsql security definer as $$
declare
  new_count int;
begin
  update users
    set sold_count = greatest(0, coalesce(sold_count, 0) + p_delta)
    where id = p_user_id
    returning sold_count into new_count;
  return new_count;
end; $$;

-- ─────────────────────────────────────────────────────────────
-- 2. ISBN uniqueness on books (กัน duplicate ISBN ใน DB)
-- ─────────────────────────────────────────────────────────────
-- Allow null isbn (legacy data) + unique constraint on non-null
-- ถ้ามี duplicate อยู่แล้ว ต้อง clean ก่อน run migration นี้
create unique index if not exists books_isbn_unique
  on books (isbn)
  where isbn is not null;

-- ─────────────────────────────────────────────────────────────
-- 3. Listing CHECK constraints (กัน bad data ผ่าน RLS bypass)
-- ─────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from information_schema.check_constraints where constraint_name = 'listings_price_positive') then
    alter table listings add constraint listings_price_positive check (price > 0 and price <= 999999);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.check_constraints where constraint_name = 'listings_photos_max_5') then
    alter table listings add constraint listings_photos_max_5 check (photos is null or array_length(photos, 1) <= 5);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.check_constraints where constraint_name = 'listings_status_valid') then
    alter table listings add constraint listings_status_valid check (status in ('active', 'sold', 'removed', 'reserved'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Listings per-user limit (enforceable at DB level via trigger)
-- ─────────────────────────────────────────────────────────────
-- Soft enforcement: API ก็ check อยู่แล้ว แต่ trigger = defense in depth
create or replace function enforce_listings_limit()
returns trigger language plpgsql as $$
declare
  active_count int;
  user_limit int;
begin
  -- เฉพาะตอน insert active (หรือ reactivate sold → active)
  if new.status <> 'active' then return new; end if;
  if tg_op = 'update' and old.status = 'active' then return new; end if;

  select count(*) into active_count from listings
    where seller_id = new.seller_id and status = 'active';

  select coalesce(listings_limit,
      case when id_verified_at is not null then 200
           when phone_verified_at is not null then 50
           else 20 end)
    into user_limit from users where id = new.seller_id;

  if active_count >= user_limit then
    raise exception 'listings_limit_reached: max %', user_limit
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists trg_enforce_listings_limit on listings;
create trigger trg_enforce_listings_limit
  before insert or update of status on listings
  for each row execute function enforce_listings_limit();
