-- Fix Thai unicode normalization in existing books data.
-- Run once after deploying the normalize fix.
--
-- Problem: Google Books returns Thai titles in DECOMPOSED form
--   ส + ◌ํ (U+0E4D NIKHAHIT) + า (U+0E32 SARA AA) → 3 chars, looks like "สํา"
-- but users type COMPOSED form
--   ส + ำ (U+0E33 SARA AM) → 2 chars, also looks like "สำ"
-- These are visually identical but byte-different → ILIKE never matches.

-- Step 1: Backfill existing rows — convert decomposed → composed
update books
set
  title = replace(title, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)),
  author = replace(author, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)),
  publisher = case when publisher is not null then replace(publisher, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) end,
  description = case when description is not null then replace(description, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) end,
  alt_titles = case when alt_titles is not null then replace(alt_titles, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) end
where
  title like '%' || chr(0x0E4D) || chr(0x0E32) || '%'
  or author like '%' || chr(0x0E4D) || chr(0x0E32) || '%'
  or (publisher is not null and publisher like '%' || chr(0x0E4D) || chr(0x0E32) || '%')
  or (description is not null and description like '%' || chr(0x0E4D) || chr(0x0E32) || '%')
  or (alt_titles is not null and alt_titles like '%' || chr(0x0E4D) || chr(0x0E32) || '%');

-- Step 2: Update the RPC to normalize on the fly too (defense in depth)
-- so any future drift is still findable.
create or replace function search_books_fuzzy(
  search_query text,
  max_results int default 50
)
returns table (
  id uuid,
  isbn text,
  title text,
  author text,
  cover_url text,
  wanted_count int,
  alt_titles text,
  rank int
)
language sql
stable
as $$
  -- normalize SARA AM in both query and stored values
  with norm as (
    select replace(search_query, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) as q
  )
  select
    b.id,
    b.isbn,
    b.title,
    b.author,
    b.cover_url,
    b.wanted_count,
    b.alt_titles,
    case
      when replace(b.title, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike (select q from norm) || '%' then 1
      when replace(b.title, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%' then 2
      when replace(coalesce(b.alt_titles, ''), chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%' then 3
      when replace(b.author, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%' then 4
      else 5
    end as rank
  from books b
  where
    replace(b.title, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%'
    or replace(b.author, chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%'
    or replace(coalesce(b.alt_titles, ''), chr(0x0E4D) || chr(0x0E32), chr(0x0E33)) ilike '%' || (select q from norm) || '%'
  order by rank, b.wanted_count desc nulls last, b.created_at desc
  limit max_results;
$$;
