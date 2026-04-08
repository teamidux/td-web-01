// External book search (Google Books + OpenLibrary) + auto-cache.
// Slower path — called separately from /api/search/db so DB results
// render first and external results stream in.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchGoogleBooksByTitle, fetchOpenLibraryByQuery, normalizeThai, GoogleBook } from '@/lib/search'

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('q')?.trim()
  if (!raw || raw.length < 2) return NextResponse.json({ results: [] })
  const q = normalizeThai(raw)

  // ยิงทั้ง 2 source คู่ขนาน — coverage แตกต่างกัน เช่น
  // หนังสือ Thai title 'เจอจุดแข็ง' (ISBN 9781595621207) ที่ Google indexed
  // เป็น 'StrengthsFinder 2.0' → OpenLibrary มีข้อมูลผ่าน edition อื่น
  const [google, openLib] = await Promise.all([
    fetchGoogleBooksByTitle(q, 15),
    fetchOpenLibraryByQuery(q, 10),
  ])

  // Merge + dedupe by ISBN, Google ก่อน (cover คุณภาพดีกว่า)
  const seen = new Set<string>()
  const gBooks: GoogleBook[] = []
  for (const b of [...google, ...openLib]) {
    if (seen.has(b.isbn)) continue
    seen.add(b.isbn)
    gBooks.push(b)
  }

  if (gBooks.length === 0) return NextResponse.json({ results: [] })

  // Auto-cache new books — normalize Thai sara am ก่อนเก็บ
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('books').upsert(
      gBooks.map(b => ({
        isbn: b.isbn,
        title: normalizeThai(b.title),
        author: normalizeThai(b.author || ''),
        publisher: b.publisher ? normalizeThai(b.publisher) : null,
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
    title: normalizeThai(b.title),
    author: normalizeThai(b.author || ''),
    cover_url: b.cover_url,
    source: 'google' as const,
  }))

  return NextResponse.json({ results })
}
