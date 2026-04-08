-- Keep books.active_listings_count + books.min_price in sync with listings.
-- Run once in Supabase SQL Editor.
--
-- Why: there was no trigger for these aggregates. App code never wrote
-- to them either, so /market and /book/[isbn] always saw zeros and
-- "ยังไม่มีคนขาย" even when active listings existed.
--
-- Strategy: recompute from source of truth (count + min) on every
-- listings change. Slower per write than an incremental delta but
-- bulletproof.

-- Step 1: Backfill from current data
update books
set
  active_listings_count = coalesce(sub.cnt, 0),
  min_price = sub.min_p
from (
  select
    book_id,
    count(*)::int as cnt,
    min(price) as min_p
  from listings
  where status = 'active'
  group by book_id
) sub
where books.id = sub.book_id;

-- Zero out books with no active listings
update books
set active_listings_count = 0, min_price = null
where (active_listings_count > 0 or min_price is not null)
  and id not in (select distinct book_id from listings where status = 'active');

-- Step 2: Trigger function — recompute aggregates for affected book(s)
create or replace function sync_books_listing_aggregates()
returns trigger
language plpgsql
security definer
as $$
declare
  affected uuid;
begin
  if TG_OP = 'DELETE' then
    affected := OLD.book_id;
  else
    affected := NEW.book_id;
  end if;

  update books
  set
    active_listings_count = coalesce((
      select count(*)::int
      from listings
      where book_id = affected and status = 'active'
    ), 0),
    min_price = (
      select min(price)
      from listings
      where book_id = affected and status = 'active'
    )
  where id = affected;

  -- Rare case: UPDATE moved a listing to a different book
  if TG_OP = 'UPDATE' and OLD.book_id is distinct from NEW.book_id then
    update books
    set
      active_listings_count = coalesce((
        select count(*)::int
        from listings
        where book_id = OLD.book_id and status = 'active'
      ), 0),
      min_price = (
        select min(price)
        from listings
        where book_id = OLD.book_id and status = 'active'
      )
    where id = OLD.book_id;
  end if;

  return null;
end;
$$;

-- Step 3: Attach trigger to listings table
drop trigger if exists trg_sync_listing_aggregates on listings;
create trigger trg_sync_listing_aggregates
  after insert or update or delete on listings
  for each row execute function sync_books_listing_aggregates();

-- Sanity check
-- select id, title, active_listings_count, min_price from books where active_listings_count > 0 order by active_listings_count desc limit 20;
