-- Security hardening (2026-10-21) — รันครั้งเดียวใน Supabase SQL Editor (โปรเจค bookmatch)
--
-- ปัญหาที่ตรวจพบจริงบน production: ฟังก์ชัน SECURITY DEFINER ใน schema public ถูกเรียกได้ด้วย anon key
-- (key ที่อยู่ใน JS bundle ของเว็บ) ผ่าน /rest/v1/rpc/... ทดสอบแล้ว adjust_sold_count / increment_pioneer_count
-- ตอบ 200/204 ให้ anon → ใครก็ปั๊ม sold_count/pioneer ให้ user ใดก็ได้ และ ban/soft-delete/hard-delete ก็อยู่ในชุดเดียวกัน
--
-- ทางแก้: ถอนสิทธิ์ EXECUTE จาก public/anon/authenticated แล้วให้เฉพาะ service_role (ที่ server ใช้)
-- โค้ดฝั่งแอปไม่ต้องแก้ — ทุกจุดที่เรียก .rpc() ของฟังก์ชันเหล่านี้อยู่ใน API route ที่ใช้ service role อยู่แล้ว
-- search_books / search_books_fuzzy / increment_book_view ปล่อยไว้ (อ่านอย่างเดียว/ไม่อันตราย)

do $$
declare f text;
begin
  foreach f in array array[
    'admin_hard_delete_user(uuid)',
    'soft_delete_user(uuid, text)',
    'ban_user(uuid, text)',
    'unban_user(uuid)',
    'adjust_sold_count(uuid, int)',
    'increment_pioneer_count(uuid)'
  ] loop
    begin
      execute format('revoke execute on function public.%s from public, anon, authenticated', f);
      execute format('grant execute on function public.%s to service_role', f);
      raise notice 'locked %', f;
    exception when undefined_function then
      raise notice 'skip (not found) %', f;
    end;
  end loop;
end $$;

-- ฟังก์ชันที่สร้างใหม่ในอนาคต: ไม่เปิดให้ anon โดยอัตโนมัติ (ต้อง grant เอง)
alter default privileges in schema public revoke execute on functions from public;

-- ตรวจผล: anon_can_call ต้องเป็น false ทุกแถว ยกเว้น search_books, search_books_fuzzy, increment_book_view
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')         as anon_can_call,
       has_function_privilege('service_role', p.oid, 'execute') as service_can_call
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1;
