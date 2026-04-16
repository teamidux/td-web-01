-- Admin hard delete user — ลบทุกอย่าง (สำหรับ test data)
-- ใช้ SECURITY DEFINER bypass RLS + จัดการ FK ครบทุก table

create or replace function admin_hard_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- 1. NULL out FK ที่ไม่มี ON DELETE CASCADE/SET NULL
  update contact_events set seller_id = null where seller_id = p_user_id;
  update contact_events set buyer_id = null where buyer_id = p_user_id;

  -- 2. ลบ contact_events ที่อ้าง listings ของ user นี้
  delete from contact_events where listing_id in (
    select id from listings where seller_id = p_user_id
  );

  -- 3. NULL out FK อื่นที่ไม่มี CASCADE
  begin update contact_messages set user_id = null where user_id = p_user_id; exception when others then null; end;
  begin update admin_actions set admin_id = null where admin_id = p_user_id; exception when others then null; end;
  begin update id_verifications set reviewed_by = null where reviewed_by = p_user_id; exception when others then null; end;
  begin update reports set reporter_user_id = null where reporter_user_id = p_user_id; exception when others then null; end;

  -- 4. ลบ tables ที่มี CASCADE (ลบตรงได้ แต่ explicit ดีกว่า)
  delete from notifications where user_id = p_user_id;
  delete from push_subscriptions where user_id = p_user_id;
  delete from phone_changes_log where user_id = p_user_id;
  begin delete from phone_otps where user_id = p_user_id; exception when others then null; end;
  delete from sessions where user_id = p_user_id;
  delete from wanted where user_id = p_user_id;
  begin delete from wanted_notifications where user_id = p_user_id; exception when others then null; end;
  begin delete from search_logs where user_id = p_user_id; exception when others then null; end;
  begin delete from id_verifications where user_id = p_user_id; exception when others then null; end;
  delete from reports where reported_user_id = p_user_id;

  -- 5. ลบ listings
  delete from listings where seller_id = p_user_id;

  -- 6. ลบ user
  delete from users where id = p_user_id;
end;
$$;
