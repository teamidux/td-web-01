// Admin: book catalog edit — list, search, update
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/admin'
import { logAdminAction } from '@/lib/audit'

export const runtime = 'nodejs'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function currentAdmin() {
  const token = cookies().get('bm_session')?.value
  if (!token) return null
  const db = sb()
  const { data } = await db.from('sessions').select('users(id)').eq('token', token).maybeSingle()
  const id = (data as any)?.users?.id
  return id && isAdmin(id) ? id : null
}

// GET — list books with search
export async function GET(req: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50))

  const db = sb()
  let query = db
    .from('books')
    .select('id, isbn, title, author, translator, publisher, description, cover_url, language, active_listings_count, wanted_count, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    // Escape ILIKE wildcards เพื่อกัน SQL-like injection — user ใส่ %,_ ไม่ทำให้ query รั่ว
    const esc = q.replace(/[%_\\]/g, m => '\\' + m)
    query = query.or(`title.ilike.%${esc}%,author.ilike.%${esc}%,isbn.ilike.%${esc}%`)
  }

  const { data: books, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ books: books || [] })
}

// POST — create new book (admin)
export async function POST(req: NextRequest) {
  const adminId = await currentAdmin()
  if (!adminId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { isbn, title, author, translator, publisher, description, cover_url, language } = await req.json()

  // Validate ISBN — must be ISBN-13 starting with 978/979
  const cleanIsbn = (isbn || '').toString().replace(/[^0-9X]/gi, '')
  if (!cleanIsbn || !/^(978|979)\d{10}$/.test(cleanIsbn)) {
    return NextResponse.json({ error: 'invalid ISBN (ต้องเป็น 13 หลัก ขึ้นต้น 978/979)' }, { status: 400 })
  }
  if (!title?.trim()) return NextResponse.json({ error: 'missing title' }, { status: 400 })

  const db = sb()

  // เช็ค ISBN ซ้ำก่อน — กันทับ
  const { data: existing } = await db.from('books').select('id, title').eq('isbn', cleanIsbn).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `ISBN นี้มีอยู่แล้ว: "${existing.title}"`, existing_id: existing.id }, { status: 409 })
  }

  const insertData = {
    isbn: cleanIsbn,
    title: title.trim().normalize('NFC'),
    author: (author || '').trim().normalize('NFC'),
    translator: translator?.trim() ? translator.trim().normalize('NFC') : null,
    publisher: publisher?.trim() ? publisher.trim().normalize('NFC') : null,
    description: description?.trim() || null,
    cover_url: cover_url?.trim() || null,
    language: language?.trim() || 'th',
    source: 'admin',
  }

  const { data: newBook, error } = await db.from('books').insert(insertData).select('id, isbn').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logAdminAction({
    adminId,
    action: 'create_book',
    targetType: 'book',
    targetId: newBook.id,
    metadata: { isbn: cleanIsbn },
  })

  return NextResponse.json({ ok: true, book: newBook })
}

// DELETE — ลบหนังสือ (+ cascade ลบ listings/wanted ตาม FK)
export async function DELETE(req: NextRequest) {
  const adminId = await currentAdmin()
  if (!adminId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const db = sb()

  // ดึงข้อมูลก่อนลบเพื่อ log audit (รู้ว่า ISBN/title อะไรหาย)
  const { data: book } = await db.from('books').select('isbn, title, active_listings_count, wanted_count').eq('id', id).maybeSingle()
  if (!book) return NextResponse.json({ error: 'book not found' }, { status: 404 })

  const { error } = await db.from('books').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logAdminAction({
    adminId,
    action: 'delete_book',
    targetType: 'book',
    targetId: id,
    metadata: {
      isbn: book.isbn,
      title: book.title,
      listings: book.active_listings_count,
      wanted: book.wanted_count,
    },
  })

  return NextResponse.json({ ok: true })
}

// PUT — update book fields
export async function PUT(req: NextRequest) {
  const adminId = await currentAdmin()
  if (!adminId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  // Whitelist editable fields — กันการ update field ที่ไม่ควรแตะ
  const allowed = ['title', 'author', 'translator', 'publisher', 'description', 'cover_url', 'language']
  const update: Record<string, any> = {}
  for (const k of allowed) {
    if (k in fields) update[k] = fields[k] === '' ? null : fields[k]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const db = sb()
  const { error } = await db.from('books').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logAdminAction({
    adminId,
    action: 'edit_book',
    targetType: 'book',
    targetId: id,
    metadata: { fields: Object.keys(update) },
  })

  return NextResponse.json({ ok: true })
}
