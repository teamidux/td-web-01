// Admin: import books from CSV
// POST body: JSON array of { isbn, title, author, source }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { books, source } = await req.json()
  if (!Array.isArray(books) || books.length === 0) {
    return NextResponse.json({ error: 'no books' }, { status: 400 })
  }
  if (!source || typeof source !== 'string') {
    return NextResponse.json({ error: 'missing source' }, { status: 400 })
  }

  const sb = admin()
  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  // Batch upsert 100 at a time — fallback row-by-row on conflict
  const BATCH = 100
  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH).map((b: any) => ({
      isbn: String(b.isbn).trim(),
      title: String(b.title || '').normalize('NFC').trim(),
      author: String(b.author || '').normalize('NFC').trim(),
      language: 'th',
      source,
    })).filter((b: any) => b.isbn.length >= 10 && b.title)

    const { data, error } = await sb
      .from('books')
      .upsert(batch, { onConflict: 'isbn', ignoreDuplicates: true })
      .select('isbn')

    if (!error) {
      inserted += (data || []).length
      skipped += batch.length - (data || []).length
    } else {
      // Fallback: row by row
      for (const row of batch) {
        const { data: d, error: e } = await sb
          .from('books')
          .upsert([row], { onConflict: 'isbn', ignoreDuplicates: true })
          .select('isbn')
        if (!e && d?.length) {
          inserted++
        } else {
          skipped++
        }
      }
    }
  }

  return NextResponse.json({ inserted, skipped, total: books.length })
}
