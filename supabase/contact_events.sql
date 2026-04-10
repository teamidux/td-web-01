-- Contact events — north star metric
-- เก็บทุกครั้งที่ผู้ซื้อกด "ติดต่อ" ผู้ขาย

create table if not exists contact_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id),
  book_id uuid references books(id),
  seller_id uuid references users(id),
  buyer_id uuid references users(id),  -- null ถ้า guest
  created_at timestamptz not null default now()
);

-- Index สำหรับ dashboard query
create index if not exists idx_contact_events_created on contact_events(created_at desc);
create index if not exists idx_contact_events_listing on contact_events(listing_id);
create index if not exists idx_contact_events_seller on contact_events(seller_id);

-- RLS: insert เท่านั้น (ผ่าน service role จาก API)
alter table contact_events enable row level security;
