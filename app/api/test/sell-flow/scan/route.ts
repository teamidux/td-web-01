// Sell flow v2: Cover scan + dedup check
// 1. AI extract จากภาพปก
// 2. ยิง search_books RPC (pg_trgm) หาหนังสือในระบบที่อาจซ้ำ
// 3. คืน candidates + flag ว่าเจอ match แน่นอนมั้ย
//
// ไม่ save เข้า DB — แค่ preview ให้ user confirm ก่อน
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractFromCover, ALLOWED_MODELS } from '@/lib/cover-vision'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Threshold ที่ตกลงกัน: ≥ 0.85 = substring match ใน title_norm = match แน่นอน
// ต่ำกว่านี้เป็น fuzzy อาจเป็นคนละเล่ม → ให้ user ตัดสินใจเอง
const AUTO_MATCH_THRESHOLD = 0.85

type Candidate = {
  id: string
  isbn: string | null
  title: string
  author: string | null
  cover_url: string | null
  score: number
}

async function searchDuplicates(title: string): Promise<Candidate[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data, error } = await supabase.rpc('search_books', { q: title, result_limit: 5 })
  if (error) {
    console.warn('[sell-flow/scan] search_books error:', error.message)
    return []
  }
  return (data || []).map((r: {
    id: string; isbn: string | null; title: string; author: string | null;
    cover_url: string | null; score: number
  }) => ({
    id: r.id, isbn: r.isbn, title: r.title, author: r.author,
    cover_url: r.cover_url, score: r.score,
  }))
}

export async function POST(req: NextRequest) {
  let body: { imageBase64?: string; mimeType?: string; model?: string; isbn?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg', isbn } = body
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }
  if (imageBase64.length > 7_000_000) {
    return NextResponse.json({ error: 'image_too_large' }, { status: 413 })
  }

  const modelId = body.model && ALLOWED_MODELS.has(body.model) ? body.model : undefined

  try {
    // ─── 1. AI extract ──────────────────────────────────────────
    const extract = await extractFromCover({ imageBase64, mimeType, modelId })

    // ─── 2. Dedup: ยิง search_books ด้วย title ที่ AI อ่านได้ ────
    // ถ้า isbn มี (มาจาก barcode scan) ยิง isbn search ก่อน (strict match)
    let candidates: Candidate[] = []
    let dedup_duration_ms = 0
    let searched_by: 'isbn' | 'title' | 'none' = 'none'

    if (isbn) {
      const t0 = Date.now()
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      const { data } = await supabase
        .from('books')
        .select('id, isbn, title, author, cover_url')
        .eq('isbn', isbn)
        .maybeSingle()
      dedup_duration_ms = Date.now() - t0
      if (data) {
        candidates = [{
          id: data.id, isbn: data.isbn, title: data.title, author: data.author,
          cover_url: data.cover_url, score: 1.0, // exact ISBN = 1.0
        }]
        searched_by = 'isbn'
      }
    }

    // ถ้า ISBN ไม่เจอ (หรือไม่มี ISBN) → ใช้ title จาก AI
    if (candidates.length === 0 && extract.parsed?.title) {
      const t0 = Date.now()
      candidates = await searchDuplicates(extract.parsed.title)
      dedup_duration_ms += Date.now() - t0
      searched_by = 'title'
    }

    const topMatch = candidates[0] && candidates[0].score >= AUTO_MATCH_THRESHOLD

    return NextResponse.json({
      extract,
      dedup: {
        candidates,
        topMatch: !!topMatch,
        searched_by,
        threshold: AUTO_MATCH_THRESHOLD,
        dedup_duration_ms,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
