-- รวมหนังสือซ้ำ: เล่มที่ผู้ขายสร้างแบบไม่มี ISBN (BM-xxxxx) ซ้ำกับเล่มที่มี ISBN อยู่แล้ว
-- พบจากรายงาน Search Console "Duplicate without user-selected canonical" (2026-10-21)
--
-- วิธีรัน: Supabase SQL Editor → วางทั้งไฟล์ → Run
-- เป็น DO block ก้อนเดียว = atomic (สำเร็จทั้งหมดหรือไม่ทำเลย) ไม่ต้องมี begin/commit
-- ถ้ามี error จะขึ้นสีแดงใต้ editor — copy ข้อความนั้นมาให้ดูได้
-- หลังรัน: trigger sync_books_listing_aggregates จะนับ active_listings_count/min_price ให้เอง
-- URL เดิม /book/BM-MA69Y และ /book/BM-KB4NW ถูก redirect (308) ไปเล่ม ISBN ใน next.config.js แล้ว

do $$
declare
  pair record;
  v_from uuid;
  v_to uuid;
  n int;
begin
  for pair in
    select * from (values
      ('BM-MA69Y', '9789749898420'),  -- The Secret เดอะซีเคร็ต
      ('BM-KB4NW', '9786162871290')   -- แก่ช้าลงแน่ แค่ปล่อยให้ท้องหิว
    ) as t(from_isbn, to_isbn)
  loop
    select id into v_from from books where isbn = pair.from_isbn;
    select id into v_to   from books where isbn = pair.to_isbn;
    if v_from is null then
      raise notice 'skip % (not found, already merged?)', pair.from_isbn;
      continue;
    end if;
    if v_to is null then
      raise exception 'target % not found', pair.to_isbn;
    end if;

    -- ย้ายประกาศขาย
    update listings set book_id = v_to where book_id = v_from;
    get diagnostics n = row_count;
    raise notice '% -> %: moved % listings', pair.from_isbn, pair.to_isbn, n;

    -- ย้ายรายการตามหา (ข้ามคนที่ตามหาเล่ม ISBN อยู่แล้ว กัน unique ซ้ำ)
    update wanted set book_id = v_to where book_id = v_from
      and not exists (select 1 from wanted w2 where w2.book_id = v_to and w2.user_id = wanted.user_id);
    delete from wanted where book_id = v_from;

    -- ตารางอื่นที่ชี้มาที่ books
    update contact_events       set book_id = v_to where book_id = v_from;
    update book_reports         set book_id = v_to where book_id = v_from;
    update wanted_notifications set book_id = v_to where book_id = v_from;

    -- เติมข้อมูลที่เล่ม ISBN ยังว่าง (รูปปกจากผู้ขาย, สำนักพิมพ์, ผู้แปล) + รวม view
    update books t set
      cover_url  = coalesce(nullif(t.cover_url, ''),  nullif(f.cover_url, '')),
      publisher  = coalesce(nullif(t.publisher, ''),  nullif(f.publisher, '')),
      translator = coalesce(nullif(t.translator, ''), nullif(f.translator, '')),
      view_count = coalesce(t.view_count, 0) + coalesce(f.view_count, 0)
    from books f
    where t.id = v_to and f.id = v_from;

    delete from books where id = v_from;

    -- recount ยืนยันอีกชั้น (trigger ทำให้อยู่แล้ว)
    update books b set
      active_listings_count = coalesce((select count(*) from listings l where l.book_id = b.id and l.status = 'active'), 0),
      min_price = (select min(price) from listings l where l.book_id = b.id and l.status = 'active')
    where b.id = v_to;
  end loop;
end $$;

-- ตรวจผล: ต้องเหลือแค่ 2 แถว (ISBN) active_listings_count = 1 มีราคา มีปก — แถว BM ต้องหายไป
select isbn, title, active_listings_count, min_price, cover_url <> '' as has_cover
from books where isbn in ('9789749898420', '9786162871290', 'BM-MA69Y', 'BM-KB4NW');
