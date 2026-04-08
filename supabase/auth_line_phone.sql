-- Add columns for LINE Login + Phone OTP verification + ID verification
-- Run once in Supabase SQL Editor.

-- 1. LINE OAuth user identifier (different from line_id which was a display handle)
alter table users add column if not exists line_user_id text unique;

-- 2. Phone verification fields
alter table users add column if not exists phone_verified_at timestamptz;

-- 3. Make phone nullable since LINE-only users don't have it until they want to sell
alter table users alter column phone drop not null;

-- 4. Avatar from LINE profile
alter table users add column if not exists avatar_url text;

-- 5. Sessions table — server-side session tokens (HTTP-only cookies map to this)
create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip text
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

alter table sessions enable row level security;
-- service role only

-- 6. Phone verification OTP codes (short-lived)
create table if not exists phone_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  phone text not null,
  code text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_otps_user_idx on phone_otps (user_id, created_at desc);

alter table phone_otps enable row level security;
-- service role only

-- 7. Audit log for phone changes (for the phone-change feature later)
create table if not exists phone_changes_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  old_phone text,
  new_phone text not null,
  changed_at timestamptz not null default now(),
  changed_by text  -- 'user' | 'admin' | 'system'
);
create index if not exists phone_changes_user_idx on phone_changes_log (user_id, changed_at desc);

alter table phone_changes_log enable row level security;

-- 8. ID verification (national ID + selfie) — Level 2 trust
alter table users add column if not exists id_verified_at timestamptz;

create table if not exists id_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  id_image_path text not null,        -- path in Supabase Storage (private bucket)
  selfie_image_path text not null,
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id)
);
create index if not exists id_verifications_status_idx on id_verifications (status, created_at desc);
create index if not exists id_verifications_user_idx on id_verifications (user_id, created_at desc);

alter table id_verifications enable row level security;
-- service role only

-- IMPORTANT: After running this SQL, also create a Supabase Storage bucket:
-- 1. Go to Supabase Dashboard → Storage → Create new bucket
-- 2. Name: "id-verifications"
-- 3. Public: NO (must be private)
-- 4. File size limit: 5 MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp
--
-- Add bucket policy (run in SQL Editor after creating the bucket):
-- create policy "id_verifications_service_role_only" on storage.objects
--   for all using (bucket_id = 'id-verifications' and auth.role() = 'service_role');
