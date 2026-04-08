// Unified search — DB (สำหรับ marketplace data) + Google Books (สำหรับ catalog)
// คู่ขนาน, merge by ISBN, ไม่มี auto-cache
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchGoogleBooksByTitle } from '@/lib/search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 1) return NextResponse.json({ results: [] })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ค้น DB และ Google Books คู่ขนาน
  const escaped = q.replace(/[%_]/g, '\\$&')
  const [google, dbBooks] = await Promise.all([
    fetchGoogleBooksByTitle(q, 20).catch(() => []),
    supabase
      .from('books')
      .select('id, isbn, title, author, cover_url, wanted_count')
      .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`)
      .limit(30)
      .then(({ data }) => data || [])
      .catch(() => []),
  ])

  // ดึง listings count + min_price จริงจาก listings table (ไม่ trust column ใน books)
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

  // Merge by ISBN — DB ก่อน (มี marketplace data) แล้วเติมด้วย Google
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
      source: 'db' as const,
    })
  }

  for (const b of google) {
    if (byIsbn.has(b.isbn)) continue
    byIsbn.set(b.isbn, {
      isbn: b.isbn,
      title: b.title,
      author: b.author || '',
      cover_url: b.cover_url || null,
      active_listings_count: 0,
      min_price: null,
      wanted_count: 0,
      source: 'google' as const,
    })
  }

  // เรียง: เล่มที่มีคนขายก่อน, แล้วตามด้วย DB ที่ไม่มีคนขาย, สุดท้ายคือ Google
  const results = Array.from(byIsbn.values()).sort((a, b) => {
    const aHasListing = (a.active_listings_count || 0) > 0 ? 1 : 0
    const bHasListing = (b.active_listings_count || 0) > 0 ? 1 : 0
    if (aHasListing !== bHasListing) return bHasListing - aHasListing
    const aIsDb = a.source === 'db' ? 1 : 0
    const bIsDb = b.source === 'db' ? 1 : 0
    return bIsDb - aIsDb
  })

  return NextResponse.json({ results })
}
