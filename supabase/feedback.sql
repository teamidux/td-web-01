-- ตารางรับเรื่องร้องเรียน/ข้อเสนอแนะทั่วไปจาก footer form
-- ต่างจาก `reports` ตรงที่ `reports` ใช้รายงาน seller โดยเฉพาะ
-- ส่วน `feedback` เป็น general — ใครก็ส่งได้ (ไม่ต้อง login)
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'general',                -- 'complaint' | 'suggestion' | 'bug' | 'general'
  message text not null,
  contact text,                                        -- optional: email/LINE ID ถ้า user อยากให้ตอบกลับ
  user_id uuid references users(id) on delete set null, -- null ถ้าไม่ได้ login
  user_agent text,
  ip_hash text,                                        -- SHA-256 ของ IP (rate limit ไม่เก็บ PII)
  status text not null default 'new',                  -- 'new' | 'reviewing' | 'resolved' | 'dismissed'
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists feedback_status_idx on feedback (status, created_at desc);
create index if not exists feedback_ip_hash_idx on feedback (ip_hash, created_at desc);

alter table feedback enable row level security;
-- ไม่เปิด policy → service role เท่านั้นที่อ่าน/เขียนได้
