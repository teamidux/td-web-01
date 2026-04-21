-- Migration: เพิ่ม column ip (raw) สำหรับ abuse tracking
-- เดิมมีแค่ ip_hash (SHA-256) — ไม่สามารถย้อนหา attacker ได้
-- ตอนนี้เก็บ raw IP ด้วย — admin ดู/block ได้ถ้าคนป่วน

alter table feedback
  add column if not exists ip text;

-- Index สำหรับ query หา spam IP
create index if not exists feedback_ip_idx on feedback (ip, created_at desc);
