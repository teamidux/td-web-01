import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Book = {
  id: string
  isbn: string
  title: string
  author: string
  translator?: string
  publisher?: string
  description?: string
  cover_url?: string
  language: string
  first_contributor_id?: string
  active_listings_count: number
  wanted_count: number
  min_price?: number
  source: string
  created_at: string
}

export type Listing = {
  id: string
  book_id: string
  seller_id: string
  condition: 'new' | 'good' | 'fair'
  price: number
  price_includes_shipping: boolean
  photos: string[]
  contact: string
  notes?: string
  status: 'active' | 'sold' | 'removed'
  sold_at?: string
  created_at: string
  books?: Book
  users?: User
}

export type User = {
  id: string
  phone: string
  display_name: string
  avatar_url?: string
  line_id?: string
  plan: string
  listings_limit: number
  sold_count: number
  confirmed_count: number
  is_verified: boolean
  is_pioneer: boolean
  pioneer_count: number
  created_at: string
}

export type Wanted = {
  id: string
  user_id: string
  book_id: string
  isbn: string
  max_price?: number
  status: string
  created_at: string
  books?: Book
}

export const CONDITIONS: Record<string, { label: string; cls: string }> = {
  new: { label: '✨ ใหม่มาก', cls: 'badge-new' },
  good: { label: '👍 ดี', cls: 'badge-good' },
  fair: { label: '📖 พอใช้', cls: 'badge-fair' },
}

export async function fetchBookByISBN(isbn: string): Promise<Partial<Book> | null> {
  const { data } = await supabase
    .from('books')
    .select('*')
    .eq('isbn', isbn)
    .maybeSingle()
  if (data) return { ...data, fromDB: true } as any

  try {
    const r = await fetch(`https://openlibrary.org/isbn/${isbn}.json`)
    if (!r.ok) return null
    const d = await r.json()

    let author = ''
    if (d.authors?.[0]?.key) {
      try {
        const ar = await fetch(`https://openlibrary.org${d.authors[0].key}.json`)
        if (ar.ok) {
          const ad = await ar.json()
          author = ad.name || ''
        }
      } catch { }
    }

    const cover_url = d.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${d.covers[0]}-M.jpg`
      : ''

    return {
      isbn,
      title: d.title || '',
      author,
      publisher: d.publishers?.[0] || '',
      cover_url,
      language: 'en',
    }
  } catch {
    return null
  }
}
