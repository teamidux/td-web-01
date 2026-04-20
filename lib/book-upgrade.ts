// ISBN auto-upgrade — merge BM-xxx books with real ISBN เมื่อ user สแกน barcode
// Scenario:
//   1. User A scan cover → AI ไม่ได้ ISBN → สร้าง BM-ABC123 title="แฮร์รี่ พอตเตอร์"
//   2. User B scan barcode 9786161234567 → title เดียวกัน
//   3. ก่อนหน้านี้: สร้าง book แยก 2 records (BM-ABC123 + 9786161234567)
//   4. ตอนนี้: UPGRADE BM-ABC123 → isbn = 9786161234567 (merge listings ใต้ book เดียว)
import type { SupabaseClient } from '@supabase/supabase-js'

// Normalize title เหมือน title_norm generated column — lowercase + strip whitespace
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, '')
}

// Normalize author สำหรับเทียบ — lowercase + strip punctuation/whitespace
function normalizeAuthor(a: string | null | undefined): string {
  return (a || '').toLowerCase().replace(/[\s,\.]+/g, '')
}

/**
 * พยายาม upgrade BM-xxx book ที่ title match → ใช้ real ISBN แทน
 * @returns bookId ของ book ที่ upgrade แล้ว หรือ null ถ้าไม่เจอ match
 */
export async function tryUpgradeBmBook(
  sb: SupabaseClient,
  opts: { isbn: string; title: string; author?: string | null }
): Promise<string | null> {
  const { isbn, title, author } = opts
  // Only upgrade if we have a real ISBN (not BM-xxx)
  if (!isbn || isbn.startsWith('BM-')) return null
  if (!title?.trim()) return null

  const titleNorm = normalizeTitle(title)
  if (titleNorm.length < 3) return null // too short, risk false match

  // Query BM-xxx books with matching normalized title
  // ใช้ title_norm column (generated, indexed) — exact match เท่านั้นกัน false positive
  const { data: candidates, error } = await sb
    .from('books')
    .select('id, title, author, isbn')
    .like('isbn', 'BM-%')
    .eq('title_norm', titleNorm)
    .limit(5)

  if (error) {
    console.error('[book-upgrade] query failed:', error.message)
    return null
  }
  if (!candidates || candidates.length === 0) return null

  // Author compatibility check — กัน match ผิดเล่ม
  // ถ้าทั้ง 2 ข้างมี author → ต้อง match (normalized)
  // ถ้าข้างใดข้างหนึ่งไม่มี → allow match (cover อาจไม่เห็น author)
  const authorNew = normalizeAuthor(author)
  const match = candidates.find(c => {
    if (!authorNew || !c.author) return true
    const authorOld = normalizeAuthor(c.author)
    if (!authorOld) return true
    // author contains / contained by (handle multi-author partial match)
    return authorOld.includes(authorNew) || authorNew.includes(authorOld)
  })
  if (!match) return null

  // Ambiguous — if > 1 candidates, reject (don't want wrong merge)
  if (candidates.length > 1) {
    console.warn(`[book-upgrade] ambiguous — ${candidates.length} BM-xxx match "${title}", skip`)
    return null
  }

  // UPGRADE: update isbn + fill author/publisher ถ้าว่าง
  const updates: Record<string, unknown> = { isbn }
  if (!match.author && author) updates.author = author
  const { error: upErr } = await sb
    .from('books')
    .update(updates)
    .eq('id', match.id)

  if (upErr) {
    // อาจ conflict ถ้า isbn มีอยู่แล้วใน DB (race) → ไม่ upgrade
    console.warn(`[book-upgrade] failed to upgrade ${match.id} → ${isbn}:`, upErr.message)
    return null
  }

  console.log(`[book-upgrade] ✓ ${match.isbn} → ${isbn} (title="${match.title}")`)
  return match.id
}
