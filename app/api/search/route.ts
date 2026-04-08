import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { searchVariants, buildOrFilter, fetchGoogleBooksByTitle } from '@/lib/search'

const DB_LIMIT = 50

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // 1. ค้นใน DB ก่อน — fuzzy variants
  const orFilter = buildOrFilter(searchVariants(q))
  const { data: dbBooks } = await supabase
    .from('books')
    .select('id, isbn, title, author, cover_url, wanted_count')
    .or(orFilter)
    .limit(DB_LIMIT)

  const dbIsbns = new Set((dbBooks || []).map(b => b.isbn))

  // 2. ขนานกัน — เรียก Google Books ลึก (max 20) เพื่อเติมเล่มที่ยังไม่อยู่ใน DB
  //    ถ้า DB มีน้อย → ผลรวมยังครอบคลุม
  let googleBooks: any[] = []
  if (q.length >= 2) {
    googleBooks = await fetchGoogleBooksByTitle(q, 20)
  }

  // 3. Auto-cache เล่มใหม่จาก Google เข้า DB เพื่อให้ search ครั้งถัดไปเจอใน DB ทันที
  const newBooks = googleBooks.filter(b => !dbIsbns.has(b.isbn))
  if (newBooks.length > 0) {
    try {
      await supabase.from('books').upsert(
        newBooks.map(b => ({
          isbn: b.isbn,
          title: b.title,
          author: b.author || '',
          publisher: b.publisher || null,
          cover_url: b.cover_url || null,
          language: b.language || 'th',
          source: 'google_books',
        })),
        { onConflict: 'isbn', ignoreDuplicates: true }
      )
    } catch (err) {
      console.error('[search auto-cache] failed:', err)
    }
  }

  // 4. ดึง listings ของเล่มใน DB เพื่อรู้ว่ามีคนขายมั้ย
  const bookIds = (dbBooks || []).map(b => b.id)
  const { data: listings } = bookIds.length
    ? await supabase
        .from('listings')
        .select('book_id, price')
        .in('book_id', bookIds)
        .eq('status', 'active')
    : { data: [] }

  const listingMap: Record<string, { count: number; min_price: number }> = {}
  for (const l of listings || []) {
    if (!listingMap[l.book_id]) listingMap[l.book_id] = { count: 0, min_price: l.price }
    listingMap[l.book_id].count++
    if (l.price < listingMap[l.book_id].min_price) listingMap[l.book_id].min_price = l.price
  }

  // 5. รวมผล: DB ก่อน (เรียงตามมีคนขาย), แล้วเติมด้วย Google ที่ไม่ซ้ำ
  const dbResults = (dbBooks || [])
    .map(b => ({ ...b, ...listingMap[b.id], source: 'db' as const }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))

  const googleOnly = newBooks.map(b => ({
    id: null,
    isbn: b.isbn,
    title: b.title,
    author: b.author,
    cover_url: b.cover_url,
    wanted_count: 0,
    count: 0,
    min_price: null,
    source: 'google' as const,
  }))

  return NextResponse.json({ results: [...dbResults, ...googleOnly] })
}
