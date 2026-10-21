// Auto-save book on detail page view + increment view_count
// Called by BookDetailClient on mount.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { isValidIsbn13 } from '@/lib/isbn'
import { isThaiBook } from '@/lib/thai-book'

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
    // Rate limit 2 ชั้น — กัน inflate view_count
    //   per-IP: 60/min (เผื่อ legit NAT เหมือนกันหลายคน)
    //   per-book+IP: 3/hour (same IP ดูเล่มเดียวกันซ้ำ = ไม่นับ)
    const ip = getClientIp(req)
    if (!checkRateLimit(`book-view:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }

    const { isbn, title, author, cover_url, publisher, language, category, list_price } = await req.json()
    if (!isbn || typeof isbn !== 'string' || !isValidIsbn13(isbn)) {
      return NextResponse.json({ error: 'invalid isbn' }, { status: 400 })
    }

    // Per-book+IP limit — กัน 1 attacker loop view ซ้ำเล่มเดียวกัน 60 ครั้ง/นาที
    // Client-side มี sessionStorage throttle แล้ว แต่ server ก็ต้อง enforce
    if (!checkRateLimit(`book-view:${ip}:${isbn}`, 3, 60 * 60_000)) {
      // silent success — ไม่ return error ให้ attacker รู้ว่าโดน throttle
      return NextResponse.json({ ok: true, throttled: true })
    }

    const sb = admin()

    // 1. ตรวจว่ามีใน DB แล้วยัง
    const { data: existing } = await sb
      .from('books')
      .select('id')
      .eq('isbn', isbn)
      .maybeSingle()

    // 2. ถ้ายังไม่มี + มี title → insert (ไม่มี view_count เพื่อกัน column ขาด)
    // Security: endpoint นี้ไม่ต้อง login (นับ view ของ guest) → ข้อมูลเล่มใหม่ต้องผ่านกรองก่อนลง catalog กลาง
    //   - จำกัดความยาวทุกช่อง, รูปปกรับเฉพาะโฮสต์ที่รู้จัก, และจำกัดการสร้างเล่มใหม่ต่อ IP (10/นาที)
    if (!existing) {
      if (!title || typeof title !== 'string') return NextResponse.json({ ok: true, skipped: 'no title' })
      if (!checkRateLimit(`book-insert:${ip}`, 10, 60_000)) return NextResponse.json({ ok: true, throttled: true })
      const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)
      const supaHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host } catch { return '' } })()
      const coverOk = (u: unknown) => {
        if (typeof u !== 'string' || u.length > 1000) return false
        try {
          const h = new URL(u)
          return h.protocol === 'https:' && (
            h.host === 'books.google.com' || h.host.endsWith('.googleusercontent.com') ||
            h.host === 'covers.openlibrary.org' || (!!supaHost && h.host === supaHost))
        } catch { return false }
      }
      const safeTitle = str(title, 500)
      if (!safeTitle) return NextResponse.json({ ok: true, skipped: 'bad title' })
      // เก็บเข้า catalog ถาวรเฉพาะหนังสือไทย — เล่มต่างประเทศยังเปิดดูได้ (ดึงสดจาก Google) แค่ไม่สร้างหน้าถาวร
      if (!isThaiBook({ isbn, title: safeTitle })) return NextResponse.json({ ok: true, skipped: 'not_thai' })
      const { error: insertErr } = await sb.from('books').insert({
        isbn,
        title: safeTitle,
        author: str(author, 300) || '',
        publisher: str(publisher, 200),
        cover_url: coverOk(cover_url) ? cover_url : null,
        language: ['th', 'en'].includes(language) ? language : 'th',
        source: 'google_books',
        category: str(category, 100),
        list_price: typeof list_price === 'number' && list_price > 0 && list_price < 100000 ? Math.round(list_price) : null,
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
