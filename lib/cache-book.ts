// Server-side helper to cache a book fetched from Google Books into our DB.
// Subsequent visits then load from our DB without re-hitting Google.
import { createClient } from '@supabase/supabase-js'

interface CacheBookInput {
  isbn: string
  title: string
  author?: string
  publisher?: string
  cover_url?: string
  language?: string
  description?: string
}

export async function cacheBookFromGoogle(input: CacheBookInput): Promise<void> {
  if (!input.isbn || !input.title) return
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('books').upsert(
      {
        isbn: input.isbn,
        title: input.title,
        author: input.author || '',
        publisher: input.publisher || null,
        cover_url: input.cover_url || null,
        language: input.language || 'th',
        description: input.description || null,
        source: 'google_books',
      },
      { onConflict: 'isbn', ignoreDuplicates: false }
    )
  } catch (err) {
    // fire-and-forget — don't crash the page if caching fails
    console.error('[cacheBookFromGoogle] failed:', err)
  }
}
