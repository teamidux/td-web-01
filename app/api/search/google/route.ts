// Google Books search + auto-cache. Slower path — called separately
// from /api/search/db so the UI can render DB results immediately and
// Google results can stream in.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchGoogleBooksByTitle } from '@/lib/search'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  const gBooks = await fetchGoogleBooksByTitle(q, 20)
  if (gBooks.length === 0) return NextResponse.json({ results: [] })

  // Auto-cache new books to DB so future searches hit immediately
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('books').upsert(
      gBooks.map(b => ({
        isbn: b.isbn,
        title: b.title,
        author: b.author || '',
        publisher: b.publisher || null,
        cover_url: b.cover_url || null,
        language: b.language || 'th',
        source: 'google_books',
      })),
      { onConflict: 'isbn', ignoreDuplicates: true }
    )
  } catch (err) {
    console.error('[search/google auto-cache]', err)
  }

  const results = gBooks.map(b => ({
    isbn: b.isbn,
    title: b.title,
    author: b.author,
    cover_url: b.cover_url,
    source: 'google' as const,
  }))

  return NextResponse.json({ results })
}
