-- User lifecycle management — Soft delete + Ban
--
-- ใช้ action ไหนเมื่อไหร่:
--   1. User ขอเลิกใช้ / PDPA request ปกติ      → soft_delete_user()
--      ข้อมูลส่วนตัวถูก null (ชื่อ/เบอร์/LINE/avatar) = comply PDPA ม.33
--      Row ยังอยู่เพื่อ marketplace integrity (history ของคนที่ซื้อขายด้วยยังครบ)
--
--   2. ตรวจพบ/สงสัยฉ้อโกง                        → ban_user()
--      **เก็บ data ครบทุกอย่างเป็นหลักฐาน** — ห้ามลบ
--      Listings → paused (reversible), เตะออก session
--      ถ้า user ขอ PDPA delete ช่วงนี้: ปฏิเสธได้ (legitimate interest ม.24)
--
--   3. Ban แล้วคดีปิด > 2 ปี ไม่มี dispute         → soft_delete_user(reason='post-fraud closed')

alter table users add column if not exists deleted_at timestamptz;
alter table users add column if not exists deleted_reason text;
alter table users add column if not exists banned_at timestamptz;
alter table users add column if not exists banned_reason text;

-- Index สำหรับกรอง active users เร็วๆ
create index if not exists idx_users_active on users(id) where deleted_at is null and banned_at is null;

-- Helper function: soft delete + ปิด listing ทั้งหมดของ user
create or replace function soft_delete_user(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
as $$
begin
  -- Mark user as deleted
  update users
  set deleted_at = now(),
      deleted_reason = p_reason,
      display_name = 'ผู้ใช้ที่ลบบัญชี',
      avatar_url = null,
      line_id = null,
      phone = null,
      store_name = null
  where id = p_user_id;

  -- ปิด listings ทั้งหมด (status → 'removed') แต่ไม่ลบ row
  update listings
  set status = 'removed'
  where seller_id = p_user_id and status = 'active';

  -- ลบ wanted list (private ของเขาเอง)
  delete from wanted where user_id = p_user_id;

  -- ลบ sessions ทั้งหมด
  delete from sessions where user_id = p_user_id;
end;
$$;

-- Ban user: กั้นไม่ให้เข้าใช้งาน + ซ่อน listings แต่ data คงเดิม (กู้คืนได้)
create or replace function ban_user(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
as $$
begin
  update users
  set banned_at = now(),
      banned_reason = p_reason
  where id = p_user_id;

  -- ซ่อน listings (pause แทน removed เพื่อกู้คืนง่าย)
  update listings
  set status = 'paused'
  where seller_id = p_user_id and status = 'active';

  -- เตะออกจากทุก session
  delete from sessions where user_id = p_user_id;
end;
$$;

create or replace function unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update users
  set banned_at = null,
      banned_reason = null
  where id = p_user_id;
end;
$$;
