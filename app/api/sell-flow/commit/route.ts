// Sell flow v2: commit — create book (if new) + listing
// ต่างจาก /api/listings/create ตรง:
//   - รองรับ book ไม่มี ISBN (synthesize BM-xxx)
//   - Tag books.source = 'vision_test' + ai_confidence + ai_extracted_at
//   - Skip book insert ถ้า user เลือก existing book จาก dedup
// ไม่แตะ production /api/listings/create
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { tryUpgradeBmBook } from '@/lib/book-upgrade'

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
  // Defense in depth: require NODE_ENV=development + ADMIN_USER_IDS + host = localhost
  // (ถ้า NODE_ENV หลุด prod ก็ยัง block เพราะ host ไม่ตรง)
  if (!user && process.env.NODE_ENV === 'development' && process.env.ADMIN_USER_IDS) {
    const host = req.headers.get('host') || ''
    const isLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
    if (isLocalhost) {
      const adminId = process.env.ADMIN_USER_IDS.split(',')[0]?.trim()
      if (adminId) user = { id: adminId }
    }
  }
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'หมดเวลาเข้าสู่ระบบ กรุณา login ใหม่' }, { status: 401 })
  // ไม่มี rate limit — auth + phone OTP + photo URL whitelist พอสำหรับกัน spam
  // (endpoint ไม่ใช้ AI → ไม่มี cost burn concern)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_json', message: 'ข้อมูลที่ส่งมาผิดรูปแบบ' }, { status: 400 })
  // Validate helper — return code + ภาษาไทย toast-ready
  const bad = (code: string, message: string) => NextResponse.json({ error: code, message }, { status: 400 })

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
  if (!ALLOWED_CONDITION.has(condition)) return bad('invalid_condition', 'กรุณาเลือกสภาพหนังสือ')
  if (!isFinite(price) || price <= 0 || price > 999999) {
    return bad('invalid_price', 'ราคาไม่ถูกต้อง (กรอก 1–999,999 บาท)')
  }
  if (!contact || contact.length > 200) return bad('invalid_contact', 'ช่องทางติดต่อไม่ถูกต้อง — เพิ่มเบอร์โทรหรือ LINE ID ในโปรไฟล์')
  if (photos.length === 0) return bad('missing_photos', 'กรุณาใส่รูปหน้าปก')
  if (photos.length > 5) return bad('too_many_photos', 'อัปโหลดได้สูงสุด 5 รูป')
  // Length caps กัน DoS จาก payload ใหญ่ + keep DB row compact
  if (title.length > 500) return bad('invalid_title', 'ชื่อหนังสือยาวเกินไป (เกิน 500 ตัว)')
  if (subtitle.length > 500) return bad('invalid_subtitle', 'ชื่อรองยาวเกินไป (เกิน 500 ตัว)')
  if (author.length > 300) return bad('invalid_author', 'ชื่อผู้เขียนยาวเกินไป (เกิน 300 ตัว)')
  if (publisher.length > 200) return bad('invalid_publisher', 'ชื่อสำนักพิมพ์ยาวเกินไป (เกิน 200 ตัว)')
  if (edition.length > 100) return bad('invalid_edition', 'ข้อมูลพิมพ์ครั้งที่ยาวเกินไป (เกิน 100 ตัว)')
  if (isbn_in.length > 20) return bad('invalid_isbn', 'ISBN ไม่ถูกต้อง')
  if (notes.length > 2000) return bad('invalid_notes', 'หมายเหตุยาวเกินไป (เกิน 2,000 ตัว)')

  // TODO: listing cap — ปลดชั่วคราว (launch phase)
  // เปิดใช้เมื่อ user ใหญ่ขึ้น + เจอ spam จริง

  // Validate photo URLs — must be from our Supabase Storage
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const EXPECTED_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/listing-photos/`
  for (const url of photos) {
    if (typeof url !== 'string' || !url.startsWith(EXPECTED_PREFIX)) {
      return bad('invalid_photo_url', 'รูปที่อัปโหลดผิดพลาด ลองใหม่อีกครั้ง')
    }
  }

  // Validate book fields (only if creating new) — author/publisher ไม่บังคับ (บางเล่มเก่าไม่รู้จริงๆ)
  if (!existing_book_id) {
    if (!title) return bad('missing_title', 'กรุณาใส่ชื่อหนังสือ')
  }

  const sb = db()
  let bookId = existing_book_id

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
    // ISBN auto-upgrade: ถ้า ISBN จริง + ไม่เจอใน DB → ลอง upgrade BM-xxx ที่ title match
    // (cover flow เคยสร้าง BM-xxx; ตอนนี้คนสแกน barcode → merge เข้า record เดียวกัน)
    if (!bookId && isbn_in) {
      const upgradedId = await tryUpgradeBmBook(sb, {
        isbn: isbn_in,
        title: subtitle ? `${title} ${subtitle}` : title,
        author,
      })
      if (upgradedId) bookId = upgradedId
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
      if (bookErr) { console.error('[sell-flow/commit] book insert:', bookErr); return NextResponse.json({ error: 'db_error', message: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง — ถ้ายังเกิดให้แจ้งผู้ดูแล' }, { status: 500 }) }
      bookId = newBook.id
    }
  }

  // Pioneer: user เป็นคนแรกที่ลงขายเล่มนี้
  // (เดิมเช็คที่ books row ใหม่ แต่ search hybrid fallback pre-import เข้า DB แล้ว → เช็คที่ listings แทน)
  const { count: existingListings } = await sb
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId!)
  const isPioneer = (existingListings || 0) === 0

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
  if (listErr) { console.error('[sell-flow/commit] listing insert:', listErr); return NextResponse.json({ error: 'db_error', message: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง — ถ้ายังเกิดให้แจ้งผู้ดูแล' }, { status: 500 }) }

  // Pioneer: ผู้บุกเบิกหนังสือเล่มนี้บน platform → +1 pioneer count
  if (isPioneer) {
    try { await sb.rpc('increment_pioneer_count', { p_user_id: user.id }) }
    catch (e) { console.error('[commit] pioneer_count failed:', e) }
  }

  const { data: bookRow } = await sb.from('books').select('isbn, title, cover_url').eq('id', bookId!).maybeSingle()

  return NextResponse.json({
    ok: true,
    book_id: bookId,
    isbn: bookRow?.isbn || null,
    title: bookRow?.title || null,
    cover_url: bookRow?.cover_url || null,
    is_new_book: isPioneer,
    source: SOURCE_TAG,
  })
}
