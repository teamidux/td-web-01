// Fast DB-only search — returns instantly so the UI can render before
// the slower Google fallback finishes.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { searchVariants, buildOrFilter, normalizeThai } from '@/lib/search'

const DB_LIMIT = 50

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('q')?.trim()
  if (!raw) return NextResponse.json({ results: [] })
  // Normalize query — แก้ปัญหา composed/decomposed sara am
  const q = normalizeThai(raw)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ลองใช้ RPC search_books_fuzzy ก่อน — ranked + ครอบ alt_titles
  let books: any[] | null = null
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_books_fuzzy', {
    search_query: q,
    max_results: DB_LIMIT,
  })

  if (rpcError) {
    // Fallback ถ้า RPC ยังไม่ถูกสร้าง (SQL ยังไม่ run) → ใช้ .or() แบบเดิม
    console.warn('[/api/search/db] RPC missing, falling back to .or():', rpcError.message)
    const orFilter = buildOrFilter(searchVariants(q))
    const { data: fallbackData } = await supabase
      .from('books')
      .select('id, isbn, title, author, cover_url, wanted_count')
      .or(orFilter)
      .limit(DB_LIMIT)
    books = fallbackData
  } else {
    books = rpcData
  }

  if (!books || books.length === 0) return NextResponse.json({ results: [] })

  // Fetch active listings to compute price + count per book
  const bookIds = books.map(b => b.id)
  const { data: listings } = await supabase
    .from('listings')
    .select('book_id, price')
    .in('book_id', bookIds)
    .eq('status', 'active')

  const listingMap: Record<string, { count: number; min_price: number }> = {}
  for (const l of listings || []) {
    if (!listingMap[l.book_id]) listingMap[l.book_id] = { count: 0, min_price: l.price }
    listingMap[l.book_id].count++
    if (l.price < listingMap[l.book_id].min_price) listingMap[l.book_id].min_price = l.price
  }

  const results = books
    .map(b => ({ ...b, ...listingMap[b.id], source: 'db' as const }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))

  return NextResponse.json({ results })
}
