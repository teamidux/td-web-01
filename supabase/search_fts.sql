-- Full-text search infrastructure — pg_trgm + normalized column + RPC
-- แก้ 4 ปัญหา: whitespace variation · word order · typo · partial match
-- Run once in Supabase SQL Editor.

-- Step 1: Enable trigram extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: Normalized title (strip whitespace + lowercase + NFC)
-- "เลิกเป็นคนดี แล้ว" → "เลิกเป็นคนดีแล้ว"
-- ใช้สำหรับ whitespace-agnostic ilike
ALTER TABLE books ADD COLUMN IF NOT EXISTS title_norm text
  GENERATED ALWAYS AS (
    lower(regexp_replace(coalesce(title, ''), '\s+', '', 'g'))
  ) STORED;

-- Step 3: Combined search text — title + author + publisher
ALTER TABLE books ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(author, '') || ' ' ||
      coalesce(publisher, '')
    )
  ) STORED;

-- Step 4: Trigram indexes — fast similarity + ilike substring
CREATE INDEX IF NOT EXISTS books_title_norm_trgm
  ON books USING gin (title_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS books_title_trgm
  ON books USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS books_search_text_trgm
  ON books USING gin (search_text gin_trgm_ops);

-- Step 5: RPC function — unified fuzzy search with ranking
-- Ranking strategy (score 0.0 - 1.0):
--   1.0 = exact prefix match (title starts with q)
--   0.9 = substring in title (as-is)
--   0.85 = substring in title_norm (whitespace-normalized)
--   0.6 = trigram similarity on title (> 0.3 threshold)
--   0.4 = substring in author
-- ORDER BY score DESC → most relevant first
CREATE OR REPLACE FUNCTION search_books(q text, result_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  isbn text,
  title text,
  author text,
  cover_url text,
  wanted_count integer,
  view_count integer,
  score real
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  q_trim text := trim(q);
  q_compact text := lower(regexp_replace(q_trim, '\s+', '', 'g'));
BEGIN
  -- Require at least 2 chars to avoid full-table scan
  IF length(q_trim) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id, b.isbn, b.title, b.author, b.cover_url,
    b.wanted_count, b.view_count,
    GREATEST(
      CASE WHEN lower(b.title) LIKE lower(q_trim) || '%' THEN 1.0 ELSE 0 END,
      CASE WHEN b.title ILIKE '%' || q_trim || '%' THEN 0.9 ELSE 0 END,
      CASE WHEN b.title_norm LIKE '%' || q_compact || '%' THEN 0.85 ELSE 0 END,
      (similarity(b.title, q_trim) * 0.6)::double precision,
      (similarity(b.title_norm, q_compact) * 0.6)::double precision,
      CASE WHEN b.author ILIKE '%' || q_trim || '%' THEN 0.4 ELSE 0 END,
      (similarity(coalesce(b.author, ''), q_trim) * 0.3)::double precision
    )::real AS score
  FROM books b
  WHERE
    b.title ILIKE '%' || q_trim || '%'
    OR b.title_norm LIKE '%' || q_compact || '%'
    OR b.title % q_trim            -- trigram similarity (default threshold 0.3)
    OR b.title_norm % q_compact
    OR b.author ILIKE '%' || q_trim || '%'
  ORDER BY score DESC, b.wanted_count DESC NULLS LAST, b.view_count DESC NULLS LAST
  LIMIT result_limit;
END;
$$;

-- Sanity check (run after applying)
-- SELECT * FROM search_books('เลิกเป็นคนดีแล้ว', 10);
-- SELECT * FROM search_books('12 กฎ', 10);
-- SELECT * FROM search_books('atomic habit', 10);
