-- Book metadata reports — user รายงานว่าข้อมูลหนังสือผิด (ตอนนี้รองรับแค่ชื่อ)
-- Admin review ที่ /tomga/reports → approve จะ update books.title + notify reporter
-- Run once in Supabase SQL Editor.

create table if not exists book_reports (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete cascade,
  isbn text,
  field text not null default 'title',                  -- 'title' | 'author' | 'cover' (future)
  current_value text,
  suggested_value text not null,
  reporter_id uuid references users(id) on delete set null,
  status text not null default 'pending',               -- 'pending' | 'approved' | 'rejected'
  admin_notes text,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists book_reports_status_idx on book_reports (status, created_at desc);
create index if not exists book_reports_book_idx on book_reports (book_id);

-- กันรายงานซ้ำ: หนึ่ง book + field ที่ยัง pending ห้ามมีเกิน 1
create unique index if not exists book_reports_pending_unique_idx
  on book_reports (book_id, field)
  where status = 'pending';

alter table book_reports enable row level security;
-- ไม่เปิด policy → service role เท่านั้น
