-- Keep books.wanted_count in sync with the wanted table automatically.
-- Run this once in Supabase SQL Editor.
--
-- Why: app code was updating books.wanted_count from the client with the
-- anon key. RLS silently rejected those updates → /market never saw any
-- demand. A trigger using SECURITY DEFINER bypasses RLS and is the
-- canonical fix for derived counters.

-- Step 1: Backfill from current wanted rows (one-time correction)
update books
set wanted_count = sub.cnt
from (
  select book_id, count(*)::int as cnt
  from wanted
  group by book_id
) sub
where books.id = sub.book_id;

-- Also zero out books that have no wanted entries
update books
set wanted_count = 0
where wanted_count > 0
  and id not in (select distinct book_id from wanted);

-- Step 2: Trigger function — increments/decrements books.wanted_count
create or replace function sync_books_wanted_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    update books
       set wanted_count = coalesce(wanted_count, 0) + 1
     where id = NEW.book_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update books
       set wanted_count = greatest(0, coalesce(wanted_count, 0) - 1)
     where id = OLD.book_id;
    return OLD;
  end if;
  return null;
end;
$$;

-- Step 3: Attach trigger to wanted table
drop trigger if exists trg_sync_wanted_count on wanted;
create trigger trg_sync_wanted_count
  after insert or delete on wanted
  for each row execute function sync_books_wanted_count();

-- Quick sanity check
-- select id, title, wanted_count from books where wanted_count > 0 order by wanted_count desc limit 20;
