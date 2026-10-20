-- รวมหนังสือซ้ำ: เล่มที่ผู้ขายสร้างแบบไม่มี ISBN (BM-xxxxx) ซ้ำกับเล่มที่มี ISBN อยู่แล้ว
-- พบจากรายงาน Search Console "Duplicate without user-selected canonical" (2026-10-21)
--
-- รันครั้งเดียวใน Supabase SQL Editor (ทั้งก้อน — เป็น transaction เดียว)
-- หลังรัน: trigger sync_books_listing_aggregates จะนับ active_listings_count/min_price ให้เอง
-- URL เดิม /book/BM-MA69Y และ /book/BM-KB4NW ถูก redirect (308) ไปเล่ม ISBN ใน next.config.js แล้ว

begin;

-- helper: ย้ายทุกอย่างจาก BM book → ISBN book แล้วลบ BM book
create or replace function pg_temp.merge_book(p_from_isbn text, p_to_isbn text)
returns void language plpgsql as $$
declare
  v_from uuid;
  v_to uuid;
begin
  select id into v_from from books where isbn = p_from_isbn;
  select id into v_to   from books where isbn = p_to_isbn;
  if v_from is null then raise notice 'skip: % not found (already merged?)', p_from_isbn; return; end if;
  if v_to   is null then raise exception 'target % not found', p_to_isbn; end if;

  -- ย้ายประกาศขาย / รายการตามหา / เหตุการณ์ติดต่อ / รายงาน
  update listings set book_id = v_to where book_id = v_from;
  update wanted   set book_id = v_to where book_id = v_from
    and not exists (select 1 from wanted w2 where w2.book_id = v_to and w2.user_id = wanted.user_id);
  delete from wanted where book_id = v_from; -- ที่เหลือคือซ้ำกับของเดิม
  update contact_events set book_id = v_to where book_id = v_from;
  begin
    update book_reports set book_id = v_to where book_id = v_from;
  exception when undefined_table or undefined_column then null; end;

  -- เติมข้อมูลที่เล่ม ISBN ยังว่าง (รูปปกจากผู้ขาย, สำนักพิมพ์, ผู้แปล)
  update books t set
    cover_url  = coalesce(nullif(t.cover_url, ''),  nullif(f.cover_url, '')),
    publisher  = coalesce(nullif(t.publisher, ''),  nullif(f.publisher, '')),
    translator = coalesce(nullif(t.translator, ''), nullif(f.translator, '')),
    view_count = coalesce(t.view_count, 0) + coalesce(f.view_count, 0)
  from books f
  where t.id = v_to and f.id = v_from;

  delete from books where id = v_from;
  raise notice 'merged % -> %', p_from_isbn, p_to_isbn;
end $$;

select pg_temp.merge_book('BM-MA69Y', '9789749898420'); -- The Secret เดอะซีเคร็ต
select pg_temp.merge_book('BM-KB4NW', '9786162871290'); -- แก่ช้าลงแน่ แค่ปล่อยให้ท้องหิว

-- recount กันพลาด (trigger ทำให้อยู่แล้ว แต่ยืนยันอีกชั้น)
update books b set
  active_listings_count = coalesce((select count(*) from listings l where l.book_id = b.id and l.status = 'active'), 0),
  min_price = (select min(price) from listings l where l.book_id = b.id and l.status = 'active')
where b.isbn in ('9789749898420', '9786162871290');

commit;

-- ตรวจผล: ควรได้ 2 แถว active_listings_count = 1 และมี cover_url
select isbn, title, active_listings_count, min_price, cover_url <> '' as has_cover
from books where isbn in ('9789749898420', '9786162871290', 'BM-MA69Y', 'BM-KB4NW');
