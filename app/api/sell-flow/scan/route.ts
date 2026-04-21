// Sell flow v2: Cover scan + dedup check
// 1. AI extract จากภาพปก
// 2. ยิง search_books RPC (pg_trgm) หาหนังสือในระบบที่อาจซ้ำ
// 3. คืน candidates + flag ว่าเจอ match แน่นอนมั้ย
//
// ไม่ save เข้า DB — แค่ preview ให้ user confirm ก่อน
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractFromCover, ALLOWED_MODELS } from '@/lib/cover-vision'
import { checkRateLimit, checkUserActionLimit, getClientIp } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/session'

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

// Multi-query dedup: ค้นด้วย AI title, combined title+subtitle, subtitle
// รวม candidates จากทุก query → dedup ตาม book.id → คง max score ต่อเล่ม
// แก้เคส AI split title/subtitle ไม่ตรงกับ DB (DB อาจ merge ไว้)
async function searchDuplicates(queries: string[]): Promise<Candidate[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const uniqueQueries = Array.from(new Set(queries.map(q => q.trim()).filter(q => q.length >= 2)))
  if (uniqueQueries.length === 0) return []

  const results = await Promise.all(uniqueQueries.map(async q => {
    const { data, error } = await supabase.rpc('search_books', { q, result_limit: 5 })
    if (error) {
      console.warn('[sell-flow/scan] search_books error:', error.message)
      return [] as unknown[]
    }
    return (data || []) as unknown[]
  }))

  // Merge: เก็บ max score ต่อ book.id
  const byId = new Map<string, Candidate>()
  for (const rows of results) {
    for (const raw of rows) {
      const r = raw as {
        id: string; isbn: string | null; title: string; author: string | null;
        cover_url: string | null; score: number
      }
      const existing = byId.get(r.id)
      if (!existing || r.score > existing.score) {
        byId.set(r.id, {
          id: r.id, isbn: r.isbn, title: r.title, author: r.author,
          cover_url: r.cover_url, score: r.score,
        })
      }
    }
  }
  // Sort desc by score, top 5
  return Array.from(byId.values()).sort((a, b) => b.score - a.score).slice(0, 5)
}

export async function POST(req: NextRequest) {
  // Feature flag — ปิดใน production ถ้าไม่ได้ enable
  if (process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN !== '1') {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 404 })
  }
  // Auth required — กัน bot spam (AI cost ~฿0.003/call)
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // 2-tier rate limit per user: burst 30/min + sustained 600/hr
  // Loose setting — shop ถ่ายซ้ำ retry ได้สบาย cap แค่ AI cost abuse
  const userLimit = checkUserActionLimit(user.id, 'sellscan', { perMin: 30, perHr: 600, actionLabel: 'สแกนปก' })
  if (userLimit.ok === false) {
    return NextResponse.json({ error: 'rate_limited', message: userLimit.message }, {
      status: 429, headers: { 'Retry-After': String(userLimit.retryAfter) },
    })
  }
  // IP-level burst limit กัน botnet farm ใต้ IP เดียว
  if (!checkRateLimit(`sellscan-ip:${getClientIp(req)}`, 50, 60_000)) {
    return NextResponse.json({ error: 'rate_limited', message: 'ช่วงนี้มีการใช้จาก IP นี้เยอะมาก รอสักครู่แล้วลองใหม่' }, { status: 429 })
  }

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

    // ถ้า ISBN ไม่เจอ (หรือไม่มี ISBN) → multi-query ด้วย title + subtitle + combined
    if (candidates.length === 0 && extract.parsed?.title) {
      const t0 = Date.now()
      const title = extract.parsed.title
      const subtitle = extract.parsed.subtitle || ''
      const queries = [
        title,
        subtitle ? `${title} ${subtitle}` : '',
        subtitle,
      ].filter(Boolean)
      candidates = await searchDuplicates(queries)
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
