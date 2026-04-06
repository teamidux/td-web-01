import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ค้นหาหนังสือ
  const { data: books, error } = await supabase
    .from('books')
    .select('id, isbn, title, author, cover_url, wanted_count')
    .ilike('title', `%${q}%`)
    .limit(30)

  if (error || !books?.length) return NextResponse.json({ results: [] })

  // ดึง listings จริงของแต่ละเล่มพร้อมกัน
  const bookIds = books.map(b => b.id)
  const { data: listings } = await supabase
    .from('listings')
    .select('book_id, price')
    .in('book_id', bookIds)
    .eq('status', 'active')

  // สร้าง map: book_id → { count, min_price }
  const listingMap: Record<string, { count: number; min_price: number }> = {}
  for (const l of listings || []) {
    if (!listingMap[l.book_id]) listingMap[l.book_id] = { count: 0, min_price: l.price }
    listingMap[l.book_id].count++
    if (l.price < listingMap[l.book_id].min_price) listingMap[l.book_id].min_price = l.price
  }

  // เรียง: เล่มที่มีคนขายก่อน
  const results = books
    .map(b => ({ ...b, ...listingMap[b.id] }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))

  return NextResponse.json({ results })
}
