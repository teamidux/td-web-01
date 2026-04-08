// Server-side helper to cache a book fetched from Google Books into our DB.
// Subsequent visits then load from our DB without re-hitting Google.
import { createClient } from '@supabase/supabase-js'
import { normalizeThai } from './search'

interface CacheBookInput {
  isbn: string
  title: string
  author?: string
  publisher?: string
  cover_url?: string
  language?: string
  description?: string
}

export async function cacheBookFromGoogle(input: CacheBookInput): Promise<boolean> {
  if (!input.isbn || !input.title) {
    console.warn('[cacheBookFromGoogle] skipped: missing isbn or title', { isbn: input.isbn, title: input.title })
    return false
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[cacheBookFromGoogle] SUPABASE_SERVICE_ROLE_KEY not set — book will not be cached')
    return false
  }
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Normalize Thai sara am ก่อนเก็บ — Google มักส่ง decomposed form
    // ที่ทำให้ ILIKE search ไม่เจอ
    const { error } = await supabase.from('books').upsert(
      {
        isbn: input.isbn,
        title: normalizeThai(input.title),
        author: normalizeThai(input.author || ''),
        publisher: input.publisher ? normalizeThai(input.publisher) : null,
        cover_url: input.cover_url || null,
        language: input.language || 'th',
        description: input.description ? normalizeThai(input.description) : null,
        source: 'google_books',
      },
      { onConflict: 'isbn', ignoreDuplicates: false }
    )
    if (error) {
      console.error('[cacheBookFromGoogle] upsert failed:', error.message, 'isbn:', input.isbn)
      return false
    }
    return true
  } catch (err) {
    console.error('[cacheBookFromGoogle] exception:', err)
    return false
  }
}
