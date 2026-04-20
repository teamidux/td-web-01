// Sell flow v2: commit — create book (if new) + listing
// ต่างจาก /api/listings/create ตรง:
//   - รองรับ book ไม่มี ISBN (synthesize BM-xxx)
//   - Tag books.source = 'vision_test' + ai_confidence + ai_extracted_at
//   - Skip book insert ถ้า user เลือก existing book จาก dedup
// ไม่แตะ production /api/listings/create
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low'])
const ALLOWED_CONDITION = new Set(['brand_new', 'new', 'good', 'fair'])
// source = 'vision' → ลงจริง tag ใน books.source
// ถ้าต้องการ isolate เทสเพิ่ม → เปลี่ยนเป็น 'vision_test' (filter ง่าย)
const SOURCE_TAG = 'vision'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function synthIsbn(): string {
  return 'BM-' + Math.random().toString(36).toUpperCase().slice(2, 7)
}

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN !== '1') {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 404 })
  }
  let user = await getSessionUser()
  // Dev-only bypass: บน localhost LINE OAuth callback ใช้ไม่ได้ → fall back admin user
  // กัน prod โดย require NODE_ENV=development + ADMIN_USER_IDS set
  if (!user && process.env.NODE_ENV === 'development' && process.env.ADMIN_USER_IDS) {
    const adminId = process.env.ADMIN_USER_IDS.split(',')[0]?.trim()
    if (adminId) user = { id: adminId }
  }
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const existing_book_id = typeof body.existing_book_id === 'string' ? body.existing_book_id : null
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : ''
  const author = typeof body.author === 'string' ? body.author.trim() : ''
  const publisher = typeof body.publisher === 'string' ? body.publisher.trim() : ''
  const edition = typeof body.edition === 'string' ? body.edition.trim() : ''
  const language = typeof body.language === 'string' ? body.language : 'th'
  const isbn_in = typeof body.isbn === 'string' ? body.isbn.trim() : ''
  const ai_confidence = typeof body.ai_confidence === 'string' && ALLOWED_CONFIDENCE.has(body.ai_confidence)
    ? body.ai_confidence : null
  const condition = typeof body.condition === 'string' ? body.condition : ''
  const price = typeof body.price === 'number' ? body.price : NaN
  const price_includes_shipping = !!body.price_includes_shipping
  const contact = typeof body.contact === 'string' ? body.contact.trim() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const photos = Array.isArray(body.photos) ? body.photos : []

  // Validate listing fields
  if (!ALLOWED_CONDITION.has(condition)) return NextResponse.json({ error: 'invalid condition' }, { status: 400 })
  if (!isFinite(price) || price <= 0 || price > 999999) {
    return NextResponse.json({ error: 'invalid price' }, { status: 400 })
  }
  if (!contact) return NextResponse.json({ error: 'missing contact' }, { status: 400 })
  if (photos.length === 0) return NextResponse.json({ error: 'missing photos' }, { status: 400 })
  if (photos.length > 5) return NextResponse.json({ error: 'too many photos' }, { status: 400 })

  // Validate photo URLs — must be from our Supabase Storage
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const EXPECTED_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/listing-photos/`
  for (const url of photos) {
    if (typeof url !== 'string' || !url.startsWith(EXPECTED_PREFIX)) {
      return NextResponse.json({ error: 'invalid photo url' }, { status: 400 })
    }
  }

  // Validate book fields (only if creating new) — author/publisher ไม่บังคับ (บางเล่มเก่าไม่รู้จริงๆ)
  if (!existing_book_id) {
    if (!title) return NextResponse.json({ error: 'missing title' }, { status: 400 })
  }

  const sb = db()
  let bookId = existing_book_id
  let isNewBook = false

  // ถ้า user เลือก existing book — UPDATE เฉพาะ field ที่ DB ยังว่าง
  // (เพื่อให้ user เติม author/publisher ที่หายได้ โดยไม่ทับข้อมูลดี)
  if (bookId) {
    const { data: current } = await sb.from('books')
      .select('author, publisher').eq('id', bookId).maybeSingle()
    if (current) {
      const updates: Record<string, string> = {}
      if (!current.author && author) updates.author = author
      if (!current.publisher && publisher) updates.publisher = publisher
      if (Object.keys(updates).length > 0) {
        await sb.from('books').update(updates).eq('id', bookId)
      }
    }
  }

  // Create book if not reusing existing
  if (!bookId) {
    const isbn = isbn_in || synthIsbn()
    // Double-check: ถ้า isbn ที่ user กรอกมามีใน DB แล้ว ใช้เล่มนั้น (กัน race)
    if (isbn_in) {
      const { data: hit } = await sb.from('books').select('id').eq('isbn', isbn).maybeSingle()
      if (hit?.id) bookId = hit.id
    }
    if (!bookId) {
      // รวม subtitle เข้า title ถ้ามี (user ขอแบบนี้ — ค้นง่ายกว่า)
      const fullTitle = subtitle ? `${title} ${subtitle}` : title
      const { data: newBook, error: bookErr } = await sb.from('books').insert({
        isbn,
        title: fullTitle,
        author: author || null,
        publisher: publisher || null,
        cover_url: photos[0],
        language,
        source: SOURCE_TAG,
        ai_confidence,
        ai_extracted_at: new Date().toISOString(),
      }).select('id').single()
      if (bookErr) return NextResponse.json({ error: bookErr.message }, { status: 500 })
      bookId = newBook.id
      isNewBook = true
    }
  }

  // Insert listing
  const { error: listErr } = await sb.from('listings').insert({
    book_id: bookId,
    seller_id: user.id,
    condition,
    price,
    price_includes_shipping,
    contact,
    notes: notes || null,
    photos,
    status: 'active',
  })
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  // Pioneer: ผู้บุกเบิกหนังสือใหม่เข้าระบบ → +1 pioneer count
  if (isNewBook) {
    try { await sb.rpc('increment_pioneer_count', { p_user_id: user.id }) } catch {}
  }

  const { data: bookRow } = await sb.from('books').select('isbn, title, cover_url').eq('id', bookId!).maybeSingle()

  return NextResponse.json({
    ok: true,
    book_id: bookId,
    isbn: bookRow?.isbn || null,
    title: bookRow?.title || null,
    cover_url: bookRow?.cover_url || null,
    is_new_book: isNewBook,
    source: SOURCE_TAG,
  })
}
