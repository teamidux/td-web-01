-- Track ISBNs that users searched/scanned but were not found in the system.
-- Use this to know which books to add manually (sorted by demand).

create table if not exists missing_isbns (
  isbn text primary key,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_source text,                    -- 'book-page' | 'sell-scan' | 'search' | etc
  last_user_id uuid references auth.users(id) on delete set null
);

create index if not exists missing_isbns_count_idx
  on missing_isbns (count desc, last_seen desc);

-- Atomic upsert + count++
create or replace function log_missing_isbn(
  p_isbn text,
  p_source text default null,
  p_user_id uuid default null
) returns void
language sql
security definer
as $$
  insert into missing_isbns (isbn, last_source, last_user_id)
  values (p_isbn, p_source, p_user_id)
  on conflict (isbn) do update set
    count = missing_isbns.count + 1,
    last_seen = now(),
    last_source = coalesce(excluded.last_source, missing_isbns.last_source),
    last_user_id = coalesce(excluded.last_user_id, missing_isbns.last_user_id);
$$;

-- RLS — only service role can read/write
alter table missing_isbns enable row level security;
