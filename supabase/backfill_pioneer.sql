-- Backfill pioneer status สำหรับ listings เก่า
-- ให้คนที่ลงขายเป็นคนแรกของแต่ละ book ได้เป็นผู้บุกเบิก

-- 1. หา listing แรกของแต่ละ book (เรียงตาม created_at)
-- 2. นับจำนวน book ที่แต่ละ user เป็นคนแรก
-- 3. update pioneer_count + is_pioneer

-- Reset ก่อน
update users set pioneer_count = 0, is_pioneer = false;

-- Update pioneer_count จาก listing แรกของแต่ละ book
with first_listings as (
  select distinct on (book_id) seller_id, book_id
  from listings
  order by book_id, created_at asc
),
counts as (
  select seller_id, count(*) as cnt
  from first_listings
  group by seller_id
)
update users
set pioneer_count = counts.cnt,
    is_pioneer = true
from counts
where users.id = counts.seller_id;
