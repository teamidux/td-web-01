-- Drop listings limit trigger — launch phase ต้องการ growth
-- รันใน Supabase SQL Editor
-- (ถ้าจะเปิดใช้ใหม่ทีหลัง run supabase/data_integrity.sql อีกครั้ง — จะสร้าง trigger กลับมา)

drop trigger if exists trg_enforce_listings_limit on listings;
-- function ไม่ drop — เก็บไว้เผื่อเปิดใหม่
-- drop function if exists enforce_listings_limit();
