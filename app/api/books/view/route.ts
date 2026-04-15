// Auto-save book on detail page view + increment view_count
// Called by BookDetailClient on mount.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 60 req/min/IP — กัน spam book creation
    const ip = getClientIp(req)
    if (!checkRateLimit(`book-view:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }

    const { isbn, title, author, cover_url, publisher, language, category, list_price } = await req.json()
    if (!isbn || !/^(978|979)\d{10}$/.test(isbn)) {
      return NextResponse.json({ error: 'invalid isbn' }, { status: 400 })
    }

    const sb = admin()

    // 1. ตรวจว่ามีใน DB แล้วยัง
    const { data: existing } = await sb
      .from('books')
      .select('id')
      .eq('isbn', isbn)
      .maybeSingle()

    // 2. ถ้ายังไม่มี + มี title → insert (ไม่มี view_count เพื่อกัน column ขาด)
    if (!existing) {
      if (!title) return NextResponse.json({ ok: true, skipped: 'no title' })
      const { error: insertErr } = await sb.from('books').insert({
        isbn,
        title,
        author: author || '',
        publisher: publisher || null,
        cover_url: cover_url || null,
        language: language || 'th',
        source: 'google_books',
        category: category || null,
        list_price: list_price || null,
      })
      if (insertErr) {
        console.error('[/api/books/view] insert error:', insertErr.message)
        return NextResponse.json({ error: 'db_error' }, { status: 500 })
      }
    }

    // 3. ลอง increment view_count (silent ignore ถ้า column ไม่มี)
    const { error: rpcErr } = await sb.rpc('increment_book_view', { p_isbn: isbn })
    if (rpcErr && !rpcErr.message?.includes('does not exist')) {
      console.warn('[view_count]', rpcErr.message)
    }

    return NextResponse.json({ ok: true, created: !existing })
  } catch (e: any) {
    console.error('[/api/books/view] error:', e?.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
