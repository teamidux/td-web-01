-- Data API grants — รองรับ Supabase change "ตารางใหม่ใน public ไม่ expose Data API อัตโนมัติ"
-- Rollout: 30 พ.ค. 2026 default ตอน create project ใหม่ / 30 ต.ค. 2026 บังคับทุก project ที่มีอยู่
--
-- ⚠️ ต้องรันใน Supabase SQL Editor ก่อนวันที่ 30 ต.ค. 2026
-- (หลังวันนั้น ตารางใหม่ที่ create จะไม่ตอบ PostgREST/GraphQL/supabase-js จนกว่าจะ GRANT)
--
-- หลักการ:
--   - public read tables → grant SELECT to anon (อ่านได้โดยไม่ login)
--   - write ผ่าน server route เท่านั้น → ไม่ grant INSERT/UPDATE/DELETE to anon
--     (server ใช้ service_role bypass RLS อยู่แล้ว — ไม่จำเป็นต้อง grant ฝั่ง anon)
--   - tables ที่ไม่อยากให้ client query → ไม่ grant อะไรกับ anon เลย
--
-- ทุกตารางที่มี policy "public_read" ใน rls_policies.sql ต้อง grant SELECT ด้วย
-- เพราะ RLS policy คือ "ถ้ามี grant แล้วเช็ค policy นี้" — ไม่มี grant = ไม่ผ่านเลย

-- ─── PUBLIC-READ TABLES (client query ได้) ───
grant select on users     to anon, authenticated;
grant select on books     to anon, authenticated;
grant select on listings  to anon, authenticated;
grant select on wanted    to anon, authenticated;
grant select on reports   to anon, authenticated;

-- ─── PRIVATE TABLES (server-only ผ่าน service_role) ───
-- ไม่ grant อะไรให้ anon/authenticated — เข้าได้เฉพาะ service_role
--   sessions, contact_events, contact_messages, feedback, notifications,
--   push_subscriptions, book_reports, admin_actions, alt_titles, etc.
--
-- ถ้าตารางใดต้องให้ client อ่าน เพิ่มบรรทัด grant select เพิ่มเองด้านบน

-- ─── INSERT/UPDATE/DELETE ───
-- ไม่ grant ให้ anon เลย — write ทั้งหมดผ่าน server route ที่ใช้ service_role
-- (rls_policies.sql ก็ DENY anon write อยู่แล้ว — grant ทับไม่ได้)

-- ─── TEMPLATE สำหรับตารางใหม่ในอนาคต ───
-- เวลา create table ใหม่ ให้เพิ่มบรรทัดที่นี่ทันที กัน 30 ต.ค. มาแล้ว missed
-- ตัวอย่าง:
--   create table new_table (...);
--   alter table new_table enable row level security;
--   create policy "new_table_public_read" on new_table for select using (true);
--   grant select on new_table to anon, authenticated;   -- ← บรรทัดนี้
