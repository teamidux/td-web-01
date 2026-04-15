-- RLS Policies v2 — harden user data (no anon access to phone/line_id)
-- Run ใน Supabase SQL Editor
-- นโยบาย: anon ห้ามอ่าน users table เลย — API ใช้ service_role ที่ bypass RLS

-- ═══════════════════════════════════════════════════════════
-- USERS — ห้าม anon อ่านทั้งหมด (API ใช้ service_role เท่านั้น)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_public_read" ON users;
DROP POLICY IF EXISTS "users_no_anon_write" ON users;
DROP POLICY IF EXISTS "users_no_anon_update" ON users;
DROP POLICY IF EXISTS "users_no_anon_delete" ON users;
DROP POLICY IF EXISTS "users_anon_deny_all" ON users;

-- ห้ามทุก operation สำหรับ anon role
-- (service_role จะ bypass RLS ทุก policy — API ใช้ได้ปกติ)
CREATE POLICY "users_anon_deny_all" ON users
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════
-- BOOKS — อ่านได้ (data สาธารณะ) เขียนห้าม
-- ═══════════════════════════════════════════════════════════
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "books_public_read" ON books;
DROP POLICY IF EXISTS "books_no_anon_write" ON books;
DROP POLICY IF EXISTS "books_no_anon_update" ON books;
DROP POLICY IF EXISTS "books_no_anon_delete" ON books;

CREATE POLICY "books_public_read" ON books FOR SELECT USING (true);
CREATE POLICY "books_no_anon_write" ON books FOR INSERT WITH CHECK (false);
CREATE POLICY "books_no_anon_update" ON books FOR UPDATE USING (false);
CREATE POLICY "books_no_anon_delete" ON books FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- LISTINGS — อ่านได้ (data สาธารณะ) เขียนห้าม
-- ═══════════════════════════════════════════════════════════
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listings_public_read" ON listings;
DROP POLICY IF EXISTS "listings_no_anon_write" ON listings;
DROP POLICY IF EXISTS "listings_no_anon_update" ON listings;
DROP POLICY IF EXISTS "listings_no_anon_delete" ON listings;

CREATE POLICY "listings_public_read" ON listings FOR SELECT USING (true);
CREATE POLICY "listings_no_anon_write" ON listings FOR INSERT WITH CHECK (false);
CREATE POLICY "listings_no_anon_update" ON listings FOR UPDATE USING (false);
CREATE POLICY "listings_no_anon_delete" ON listings FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- WANTED — anon ห้ามอ่านรายการตามหา (มี user_id เชื่อมโยง)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE wanted ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wanted_public_read" ON wanted;
DROP POLICY IF EXISTS "wanted_no_anon_write" ON wanted;
DROP POLICY IF EXISTS "wanted_no_anon_update" ON wanted;
DROP POLICY IF EXISTS "wanted_no_anon_delete" ON wanted;
DROP POLICY IF EXISTS "wanted_anon_deny_all" ON wanted;

CREATE POLICY "wanted_anon_deny_all" ON wanted
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════
-- Other sensitive tables — deny anon (skip ถ้า table ไม่มี)
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['search_logs', 'push_subscriptions', 'notifications', 'sessions', 'phone_otps', 'phone_changes_log', 'id_verifications', 'contact_events', 'contact_messages', 'wanted_notifications', 'reports', 'admin_actions'];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%I_anon_deny_all" ON %I', tbl, tbl);
      EXECUTE format('CREATE POLICY "%I_anon_deny_all" ON %I FOR ALL USING (false) WITH CHECK (false)', tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- NOTE:
-- - service_role key (ที่ใช้ใน API routes) bypass RLS เสมอ — ทำงานปกติ
-- - anon key (public) จะถูก block จาก users/wanted/sessions/etc.
-- - ถ้า client component เคย query users/wanted ผ่าน supabase anon → ต้องย้ายไปผ่าน API route
