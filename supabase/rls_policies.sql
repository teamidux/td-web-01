-- RLS Policies สำหรับ tables หลัก
-- ⚠️ ต้อง run ใน Supabase SQL Editor
-- ป้องกัน anon key (ที่อยู่ใน client JS) จากการ read/write โดยไม่ได้รับอนุญาต

-- ═══════════════════════════════════════════════════════════
-- USERS table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- อ่านได้: เฉพาะ field ที่ปลอดภัย (ไม่รวม phone, line_id)
-- ใช้ view แทน select('*') — แต่ถ้ายังใช้ select ตรง ให้ policy กัน
CREATE POLICY "users_public_read" ON users
  FOR SELECT USING (true);
-- หมายเหตุ: API แยก line_id/phone ออกแล้ว แต่ client supabase ยังดึงได้
-- ถ้าอยากปิดสนิท ให้ใช้ view แทน table ตรง

-- เขียน: เฉพาะ service role (ผ่าน API)
-- anon key จะ insert/update/delete users ไม่ได้
CREATE POLICY "users_no_anon_write" ON users
  FOR INSERT WITH CHECK (false);
CREATE POLICY "users_no_anon_update" ON users
  FOR UPDATE USING (false);
CREATE POLICY "users_no_anon_delete" ON users
  FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- BOOKS table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE books ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุกคน (catalog เป็น public)
CREATE POLICY "books_public_read" ON books
  FOR SELECT USING (true);

-- เขียน: เฉพาะ service role (ผ่าน API)
CREATE POLICY "books_no_anon_write" ON books
  FOR INSERT WITH CHECK (false);
CREATE POLICY "books_no_anon_update" ON books
  FOR UPDATE USING (false);
CREATE POLICY "books_no_anon_delete" ON books
  FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- LISTINGS table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุกคน (marketplace เป็น public)
CREATE POLICY "listings_public_read" ON listings
  FOR SELECT USING (true);

-- เขียน: เฉพาะ service role (ผ่าน API)
CREATE POLICY "listings_no_anon_write" ON listings
  FOR INSERT WITH CHECK (false);
CREATE POLICY "listings_no_anon_update" ON listings
  FOR UPDATE USING (false);
CREATE POLICY "listings_no_anon_delete" ON listings
  FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- WANTED table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE wanted ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุกคน
CREATE POLICY "wanted_public_read" ON wanted
  FOR SELECT USING (true);

-- เขียน: เฉพาะ service role (ผ่าน API)
CREATE POLICY "wanted_no_anon_write" ON wanted
  FOR INSERT WITH CHECK (false);
CREATE POLICY "wanted_no_anon_update" ON wanted
  FOR UPDATE USING (false);
CREATE POLICY "wanted_no_anon_delete" ON wanted
  FOR DELETE USING (false);

-- ═══════════════════════════════════════════════════════════
-- SEARCH_LOGS table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
-- เฉพาะ service role
-- ไม่สร้าง policy = anon key อ่าน/เขียนไม่ได้เลย

-- ═══════════════════════════════════════════════════════════
-- PUSH_SUBSCRIPTIONS table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- เฉพาะ service role
