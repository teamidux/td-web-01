// Unified search — DB + Google Books
//
// หลักการ (รื้อใหม่ — KISS):
//   1. DB ค้นด้วย ilike substring บน title/author + variant ที่ตัดช่องว่าง
//   2. Google ดึงดิบ 40 เล่ม ไม่ filter อะไรทั้งนั้น
//   3. Merge by ISBN — DB ก่อน (มี marketplace data) → Google ตามลำดับที่ Google คืน
//   4. Sort: เล่มที่มีคนขายขึ้นบน (ตาม listing count desc) → ที่ไม่มีตามมา (preserve order)
//   5. Auto-cache: เก็บทุกเล่มจาก Google raw เข้า DB (ไม่ตัดด้วย rank)
//
// mode=db   → query เฉพาะ DB (ฟรี ไม่กิน Google quota) — ใช้กับ live search
// mode=all  → DB + Google + auto-cache — ใช้ตอน user explicit click "ค้นหา"
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchGoogleBooksRawDebug, fetchGoogleBooksMultiPage, normalizeForMatch } from '@/lib/search'

// Edge runtime: รันที่ edge ใกล้ user (Singapore สำหรับผู้ใช้ไทย) ไม่ใช่ที่
// iad1 ตาม Hobby plan default — สำคัญเพราะ Google Books API geo-localize
// ตาม caller IP, ถ้ารันที่ US จะได้แต่หนังสือไม่เกี่ยวกับหนังสือไทย
export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 1) return NextResponse.json({ results: [] })

  const mode = req.nextUrl.searchParams.get('mode') === 'db' ? 'db' : 'all'
  const wantDebug = req.nextUrl.searchParams.get('debug') === '1'
  // pages: จำนวน page Google ที่จะดึง (1=light/live, 5=deep/button) max 10
  const pagesParam = parseInt(req.nextUrl.searchParams.get('pages') || '1', 10)
  const pages = Math.max(1, Math.min(isNaN(pagesParam) ? 1 : pagesParam, 10))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ─────────────────────────────────────────────────────────────────
  // 1. DB QUERY
  // ─────────────────────────────────────────────────────────────────
  // Variant 1: query ตามที่ user พิมพ์ (escape % และ _ ที่เป็น wildcard)
  // Variant 2: ตัดช่องว่างทั้งหมด — รองรับ "คิดใหญ่ ไม่คิดเล็ก" vs "คิดใหญ่ไม่คิดเล็ก"
  // ใช้ separate queries แทน .or() — supabase-js OR filter มี edge case กับ Thai chars
  const escaped = q.replace(/[%_]/g, '\\$&')
  const escapedNoWs = escaped.replace(/\s+/g, '')
  const variants: string[] = [escaped]
  if (escapedNoWs !== escaped && escapedNoWs.length > 0) variants.push(escapedNoWs)

  const SELECT_COLS = 'id, isbn, title, author, cover_url, wanted_count, view_count'
  const dbQuery = (async () => {
    try {
      const queries: any[] = []
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]
        queries.push(
          supabase.from('books').select(SELECT_COLS).ilike('title', `%${v}%`).limit(50),
          supabase.from('books').select(SELECT_COLS).ilike('author', `%${v}%`).limit(20),
        )
      }
      const results: any[] = await Promise.all(queries)
      const merged: any[] = []
      const seen = new Set<string>()
      for (const r of results) {
        for (const b of (r.data || [])) {
          if (!b.id || seen.has(b.id)) continue
          seen.add(b.id)
          merged.push(b)
        }
      }
      return merged
    } catch (err: any) {
      console.error('[search] db query error:', err?.message || err)
      return []
    }
  })()

  // ─────────────────────────────────────────────────────────────────
  // 2. GOOGLE QUERY (raw — ไม่ filter)
  // ─────────────────────────────────────────────────────────────────
  // pages=1 → ใช้ debug version (1 call, มี sample_item ครบ)
  // pages>1 → ใช้ multi-page parallel (deep search ตอนกดปุ่ม)
  const googlePromise = mode === 'db'
    ? Promise.resolve({ books: [] as any[], debug: null as any, pagesDebug: null as any })
    : pages === 1
      ? fetchGoogleBooksRawDebug(q).then(r => ({ books: r.books, debug: r.debug, pagesDebug: null as any }))
      : fetchGoogleBooksMultiPage(q, pages).then(r => ({ books: r.books, debug: null as any, pagesDebug: r.pagesDebug }))

  const [googleResult, dbBooks] = await Promise.all([googlePromise, dbQuery])
  const googleRaw = googleResult.books
  const googleDebug = googleResult.debug
  const pagesDebug = googleResult.pagesDebug

  // ─────────────────────────────────────────────────────────────────
  // 3. ดึง listings count + min_price จริงจาก listings table
  // ─────────────────────────────────────────────────────────────────
  const bookIds = (dbBooks || []).map(b => b.id).filter(Boolean)
  const listingMap: Record<string, { count: number; min_price: number }> = {}
  if (bookIds.length > 0) {
    const { data: listings } = await supabase
      .from('listings')
      .select('book_id, price')
      .in('book_id', bookIds)
      .eq('status', 'active')
    for (const l of listings || []) {
      if (!listingMap[l.book_id]) listingMap[l.book_id] = { count: 0, min_price: l.price }
      listingMap[l.book_id].count++
      if (l.price < listingMap[l.book_id].min_price) listingMap[l.book_id].min_price = l.price
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. MERGE — DB ก่อน, Google ตามลำดับที่ Google คืน
  // ─────────────────────────────────────────────────────────────────
  const byIsbn = new Map<string, any>()

  for (const b of dbBooks) {
    if (!b.isbn) continue
    const lm = listingMap[b.id] || { count: 0, min_price: null as any }
    byIsbn.set(b.isbn, {
      isbn: b.isbn,
      title: b.title,
      author: b.author || '',
      cover_url: b.cover_url || null,
      active_listings_count: lm.count,
      min_price: lm.min_price,
      wanted_count: b.wanted_count || 0,
      view_count: (b as any).view_count || 0,
      source: 'db' as const,
    })
  }

  for (const b of googleRaw) {
    if (!b.isbn || byIsbn.has(b.isbn)) continue
    byIsbn.set(b.isbn, {
      isbn: b.isbn,
      title: b.title,
      author: b.author || '',
      cover_url: b.cover_url || null,
      active_listings_count: 0,
      min_price: null,
      wanted_count: 0,
      view_count: 0,
      source: 'google' as const,
    })
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. SORT — listings ก่อน → ที่ไม่มีตาม
  // ─────────────────────────────────────────────────────────────────
  const allBooks = Array.from(byIsbn.values())
  const withListings = allBooks
    .filter(b => (b.active_listings_count || 0) > 0)
    .sort((a, b) => (b.active_listings_count - a.active_listings_count) || ((b.view_count || 0) - (a.view_count || 0)))
  const noListings = allBooks.filter(b => (b.active_listings_count || 0) === 0)
  // noListings ไม่ sort — preserve ลำดับจาก DB→Google เดิม (Google มี relevance order ของตัวเอง)

  const results = [...withListings, ...noListings]

  // ─────────────────────────────────────────────────────────────────
  // 6. MATCH QUALITY — exact (ตรง/prefix) vs partial (substring) — สำหรับ UI label
  // ─────────────────────────────────────────────────────────────────
  const qNorm = normalizeForMatch(q)
  const topNorm = normalizeForMatch(results[0]?.title || '')
  const isExact = !!qNorm && (topNorm === qNorm || topNorm.startsWith(qNorm))
  const matchQuality: 'exact' | 'partial' | 'none' =
    results.length === 0 ? 'none' : isExact ? 'exact' : 'partial'

  // ─────────────────────────────────────────────────────────────────
  // 7. AUTO-CACHE — เก็บทุกเล่มจาก Google raw เข้า DB (ไม่ filter strict)
  // ─────────────────────────────────────────────────────────────────
  const dbIsbnSet = new Set((dbBooks || []).map((b: any) => b.isbn).filter(Boolean))
  const toCache = (googleRaw || [])
    .filter((b: any) => b.isbn && b.title && !dbIsbnSet.has(b.isbn))
    .map((b: any) => ({
      isbn: b.isbn,
      // NFC normalize — กัน Thai unicode bug (composed/decomposed sara am)
      title: String(b.title).normalize('NFC'),
      author: String(b.author || '').normalize('NFC'),
      publisher: b.publisher ? String(b.publisher).normalize('NFC') : null,
      cover_url: b.cover_url || null,
      language: b.language || 'th',
      source: 'google_books',
      category: b.category || null,
      list_price: b.list_price || null,
    }))

  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  let cachedCount = 0
  let cacheError: string | null = null
  if (hasServiceRole && toCache.length > 0) {
    // Await จริง — เพื่อให้ debug stats สะท้อนผลจริงใน response
    const { data: upserted, error } = await supabase
      .from('books')
      .upsert(toCache, { onConflict: 'isbn', ignoreDuplicates: true })
      .select('isbn')
    if (error) {
      cacheError = error.message
      console.error('[search] cache fail:', error.message)
    } else {
      cachedCount = (upserted || []).length
    }
  } else if (!hasServiceRole) {
    cacheError = 'no_service_role_key'
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. SEARCH LOG — fire-and-forget, ไม่ block response
  // ─────────────────────────────────────────────────────────────────
  if (hasServiceRole) {
    Promise.resolve(supabase.from('search_logs').insert({
      keyword: q,
      result_count: results.length,
      mode,
    })).catch(() => {})
  }

  return NextResponse.json({
    results,
    matchQuality,
    ...(wantDebug && {
      debug: {
        query: q,
        mode,
        pages,
        google_raw_count: googleRaw.length,
        db_match_count: dbBooks.length,
        merged_count: results.length,
        to_cache_count: toCache.length,
        cached_count: cachedCount,
        cache_error: cacheError,
        google_isbns: googleRaw.map((b: any) => b.isbn),
        db_isbns: Array.from(dbIsbnSet),
        google: googleDebug,
        pages_breakdown: pagesDebug,
      },
    }),
  })
}
