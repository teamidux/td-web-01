// Admin: book catalog edit — list, search, update
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/admin'

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
  const q = (url.searchParams.get('q') || '').trim()

  const db = sb()
  let query = db
    .from('books')
    .select('id, isbn, title, author, translator, publisher, description, cover_url, language, active_listings_count, wanted_count, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (q) {
    query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%,isbn.ilike.%${q}%`)
  }

  const { data: books, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ books: books || [] })
}

// PUT — update book fields
export async function PUT(req: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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

  return NextResponse.json({ ok: true })
}
