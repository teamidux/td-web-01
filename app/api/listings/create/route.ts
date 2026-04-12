// สร้าง listing ใหม่ — ย้ายจาก client-side supabase insert
// รวม: สร้าง/หา book + insert listing
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const {
    isbn, title, author, translator, cover_url, language,
    condition, price, price_includes_shipping, contact, notes, photos,
    existing_book_id, existing_cover_url,
  } = await req.json()

  // Validate
  if (!isbn) return NextResponse.json({ error: 'missing isbn' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'missing title' }, { status: 400 })
  if (!price || isNaN(price) || price <= 0 || price > 999999) {
    return NextResponse.json({ error: 'invalid price' }, { status: 400 })
  }
  if (!contact?.trim()) return NextResponse.json({ error: 'missing contact' }, { status: 400 })
  if (!condition) return NextResponse.json({ error: 'missing condition' }, { status: 400 })

  const sb = db()

  // 1. หา/สร้าง book
  let bookId = existing_book_id
  let bookCoverUrl = existing_cover_url || ''

  if (!bookId) {
    const { data: existing } = await sb.from('books').select('id, cover_url').eq('isbn', isbn).maybeSingle()
    if (existing?.id) {
      bookId = existing.id
      bookCoverUrl = existing.cover_url || ''
    } else {
      const { data: newBook, error: bookErr } = await sb.from('books').insert({
        isbn,
        title,
        author: author || '',
        translator: translator || '',
        cover_url: cover_url || '',
        language: language || 'th',
        source: 'community',
      }).select('id').single()
      if (bookErr) return NextResponse.json({ error: bookErr.message }, { status: 500 })
      bookId = newBook.id
    }
  }

  // 2. Update cover ถ้ายังไม่มี + มีรูปใหม่
  if (!bookCoverUrl && photos?.[0] && bookId) {
    await sb.from('books').update({ cover_url: photos[0] }).eq('id', bookId)
  }

  // 3. Insert listing
  const { error: listErr } = await sb.from('listings').insert({
    book_id: bookId,
    seller_id: user.id,
    condition,
    price,
    price_includes_shipping: !!price_includes_shipping,
    contact: contact.trim(),
    notes: notes?.trim() || null,
    photos: photos || [],
    status: 'active',
  })
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, book_id: bookId, isbn })
}
