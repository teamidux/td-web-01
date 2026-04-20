// สร้าง listing ใหม่ — ย้ายจาก client-side supabase insert
// รวม: สร้าง/หา book + insert listing
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { tryUpgradeBmBook } from '@/lib/book-upgrade'

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

  // Spam cap: จำกัด active listings ต่อ user — กัน 1 user สร้าง 1000 listings
  // Verified sellers (phone + ID) ได้ limit สูงกว่า (trust signal)
  const sbCheck = db()
  const { count: activeCount } = await sbCheck
    .from('listings')
    .select('*', { count: 'exact', head: true })
    .eq('seller_id', user.id)
    .eq('status', 'active')
  const { data: userRow } = await sbCheck
    .from('users')
    .select('is_verified, phone_verified_at, listings_limit')
    .eq('id', user.id)
    .maybeSingle()
  const baseLimit = userRow?.listings_limit || (userRow?.is_verified ? 200 : userRow?.phone_verified_at ? 50 : 20)
  if ((activeCount || 0) >= baseLimit) {
    return NextResponse.json({
      error: 'listings_limit_reached',
      message: `ลงขายได้สูงสุด ${baseLimit} เล่มพร้อมกัน — ยืนยันตัวตนเพิ่ม limit`,
      current: activeCount,
      limit: baseLimit,
    }, { status: 429 })
  }

  // Validate photos: array, length ≤ 5, URLs ต้องมาจาก Supabase Storage ของเรา
  // กัน: (1) array ยาวเกินล้น (2) URL ชี้ไปเว็บอื่น (XSS/hotlink)
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const EXPECTED_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/listing-photos/`
  if (photos !== undefined && photos !== null) {
    if (!Array.isArray(photos)) return NextResponse.json({ error: 'invalid photos' }, { status: 400 })
    if (photos.length > 5) return NextResponse.json({ error: 'too many photos' }, { status: 400 })
    for (const url of photos) {
      if (typeof url !== 'string' || !url.startsWith(EXPECTED_PREFIX)) {
        return NextResponse.json({ error: 'invalid photo url' }, { status: 400 })
      }
    }
  }

  const sb = db()

  // 1. หา/สร้าง book
  let bookId = existing_book_id
  let bookCoverUrl = existing_cover_url || ''
  let isNewBook = false

  if (!bookId) {
    const { data: existing } = await sb.from('books').select('id, cover_url').eq('isbn', isbn).maybeSingle()
    if (existing?.id) {
      bookId = existing.id
      bookCoverUrl = existing.cover_url || ''
    } else {
      // ISBN auto-upgrade: ถ้าเป็น ISBN จริง ลอง upgrade BM-xxx book ที่ title match ก่อน
      // (กัน duplicate records ระหว่าง cover flow และ barcode flow)
      if (!isbn.startsWith('BM-')) {
        const upgradedId = await tryUpgradeBmBook(sb, { isbn, title, author })
        if (upgradedId) {
          bookId = upgradedId
        }
      }
    }
    if (!bookId) {
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
      isNewBook = true
    }
  }

  // 2. Update cover เฉพาะถ้ายังไม่มีรูปเลย
  // ถ้ามีจาก Google Books = ปกจริงจากสำนักพิมพ์ ดีกว่ารูปถ่าย → เก็บไว้
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

  // 4. ถ้าเป็นหนังสือใหม่ → update pioneer_count ให้ user
  if (isNewBook) {
    try { await sb.rpc('increment_pioneer_count', { p_user_id: user.id }) }
    catch (e) { console.error('[listings/create] pioneer_count failed:', e) }
  }

  return NextResponse.json({ ok: true, book_id: bookId, isbn, is_new_book: isNewBook })
}
