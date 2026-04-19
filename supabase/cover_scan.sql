-- Cover Scan: เพิ่ม metadata สำหรับติดตามหนังสือที่ AI อ่านปกให้
-- Run: Supabase SQL Editor (idempotent — รันซ้ำได้)
--
-- Schema หลักไม่เปลี่ยน — แค่เพิ่ม 2 column optional + 1 index
-- books.source (column เดิม) จะรับค่าใหม่: 'vision' | 'vision+barcode'
--   - vision           = ถ่ายปกอย่างเดียว (ไม่มี ISBN)
--   - vision+barcode   = มี ISBN จาก barcode scan แต่ DB/Google ไม่มี → ถ่ายปกเพิ่ม
-- (convention level — ไม่ต้อง CHECK constraint เพื่อไม่แตะ row เดิม)

-- ─── 1. AI confidence — บันทึกระดับความมั่นใจจาก Vision API ──────
-- null = ไม่ใช่ AI extracted (เดิมจาก Google Books หรือ manual)
-- high/medium/low = AI extracted
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS ai_confidence text
    CHECK (ai_confidence IS NULL OR ai_confidence IN ('high', 'medium', 'low'));

-- ─── 2. AI extracted timestamp — สำหรับ admin review queue ──────
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS ai_extracted_at timestamptz;

-- ─── 3. Partial index — admin filter "AI-extracted books" รวดเร็ว ──
-- Partial: index เฉพาะแถวที่ AI extract (ไม่บวมกับหนังสือ 51K เดิม)
CREATE INDEX IF NOT EXISTS idx_books_ai_review
  ON books (ai_extracted_at DESC)
  WHERE ai_confidence IS NOT NULL;

-- Sanity check: list AI-extracted books (สำหรับ admin review)
-- SELECT id, title, author, ai_confidence, ai_extracted_at, source
-- FROM books
-- WHERE ai_confidence IS NOT NULL
-- ORDER BY ai_extracted_at DESC
-- LIMIT 20;
