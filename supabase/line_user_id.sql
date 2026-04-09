-- Add line_user_id column for LINE OAuth login
-- IMPORTANT: This is DIFFERENT from line_id:
--   - line_id        = public LINE ID ที่ user ตั้งเอง (สำหรับให้ผู้อื่น add)
--   - line_user_id   = LINE OAuth internal user ID (opaque, e.g. U1234abc...)
--                      ใช้ link account + push notification ผ่าน Messaging API
--
-- ก่อนรัน: ตรวจว่ายังไม่มี user ในระบบที่ login ผ่าน LINE
-- (ถ้ามี ต้องมี migration เพิ่มเพื่อ backfill)

alter table public.users
  add column if not exists line_user_id text;

-- Partial unique index — กัน duplicate ของ line_user_id ที่ไม่ null
-- (อนุญาต null ซ้ำได้ สำหรับ user ที่ยังไม่ link LINE)
create unique index if not exists users_line_user_id_unique
  on public.users (line_user_id)
  where line_user_id is not null;

-- Verify:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name = 'line_user_id';
