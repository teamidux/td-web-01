// Crowdsourced book aliases — user adds Thai/alternate name for a book
// so it becomes findable when searched in that language.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { normalizeThai } from '@/lib/search'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { isbn, alias } = await req.json()
  if (!isbn || typeof isbn !== 'string') {
    return NextResponse.json({ error: 'missing isbn' }, { status: 400 })
  }
  const cleaned = normalizeThai((alias || '').trim().slice(0, 200))
  if (cleaned.length < 2) {
    return NextResponse.json({ error: 'alias too short' }, { status: 400 })
  }

  const sb = admin()
  // Get current alt_titles, append, dedupe
  const { data: book } = await sb.from('books').select('id, alt_titles').eq('isbn', isbn).maybeSingle()
  if (!book) return NextResponse.json({ error: 'book not found' }, { status: 404 })

  const existing: string[] = book.alt_titles
    ? book.alt_titles.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []
  if (existing.some(e => e.toLowerCase() === cleaned.toLowerCase())) {
    return NextResponse.json({ ok: true, already_exists: true })
  }
  existing.push(cleaned)
  const newValue = existing.join(', ')

  const { error } = await sb.from('books').update({ alt_titles: newValue }).eq('id', book.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
