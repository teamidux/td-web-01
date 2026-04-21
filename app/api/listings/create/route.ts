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
  // ไม่มี rate limit — auth + phone OTP + photo URL whitelist พอสำหรับกัน spam
  // (endpoint ไม่ใช้ AI → ไม่มี cost burn concern)

  const {
    isbn, title, author, translator, cover_url, language,
    condition, price, price_includes_shipping, contact, notes, photos,
    existing_book_id, existing_cover_url,
  } = await req.json()

  // Validate
  if (!isbn || typeof isbn !== 'string' || isbn.length > 20) return NextResponse.json({ error: 'missing isbn' }, { status: 400 })
  if (!title || typeof title !== 'string' || title.length > 500) return NextResponse.json({ error: 'invalid title' }, { status: 400 })
  // isFinite() catch Infinity/-Infinity/NaN ในคราวเดียว
  if (typeof price !== 'number' || !isFinite(price) || price <= 0 || price > 999999) {
    return NextResponse.json({ error: 'invalid price' }, { status: 400 })
  }
  if (!contact?.trim() || contact.length > 200) return NextResponse.json({ error: 'invalid contact' }, { status: 400 })
  if (!condition) return NextResponse.json({ error: 'missing condition' }, { status: 400 })
  // Length caps กัน DoS จาก payload ใหญ่
  if (author && (typeof author !== 'string' || author.length > 300)) return NextResponse.json({ error: 'invalid author' }, { status: 400 })
  if (translator && (typeof translator !== 'string' || translator.length > 300)) return NextResponse.json({ error: 'invalid translator' }, { status: 400 })
  if (notes && (typeof notes !== 'string' || notes.length > 2000)) return NextResponse.json({ error: 'invalid notes' }, { status: 400 })

  // TODO: listing cap — ปลดชั่วคราว (launch phase ต้องการ growth ก่อน)
  // เปิดใช้เมื่อ user ใหญ่ขึ้น + เจอ spam จริง
  // เดิม: 20/50/200 tier ตาม verification

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
      if (bookErr) { console.error('[listings/create] book insert:', bookErr); return NextResponse.json({ error: 'db_error' }, { status: 500 }) }
      bookId = newBook.id
    }
  }

  // Pioneer: user เป็นคนแรกที่ลงขายเล่มนี้บน platform
  // (เดิมเช็คว่า books row ใหม่ถูกสร้าง แต่ search hybrid fallback
  //  pre-import Google Books เข้า DB แล้ว → ต้องเช็คที่ listings แทน)
  const { count: existingListings } = await sb
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId)
  const isPioneer = (existingListings || 0) === 0

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
  if (listErr) { console.error('[listings/create] listing insert:', listErr); return NextResponse.json({ error: 'db_error' }, { status: 500 }) }

  // 4. ถ้า user เป็น pioneer → update pioneer_count
  if (isPioneer) {
    try { await sb.rpc('increment_pioneer_count', { p_user_id: user.id }) }
    catch (e) { console.error('[listings/create] pioneer_count failed:', e) }
  }

  return NextResponse.json({ ok: true, book_id: bookId, isbn, is_new_book: isPioneer })
}
