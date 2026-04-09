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
  active_listings_count: number
  wanted_count: number
  min_price?: number
  source: string
  alt_titles?: string | null
  created_at: string
}

export type Listing = {
  id: string
  book_id: string
  seller_id: string
  condition: 'brand_new' | 'new' | 'good' | 'fair'
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
  phone?: string | null
  phone_verified_at?: string | null
  line_user_id?: string | null
  display_name: string
  avatar_url?: string | null
  line_id?: string
  seller_type: 'individual' | 'store'
  store_name?: string
  plan: string
  listings_limit: number
  sold_count: number
  confirmed_count: number
  is_verified: boolean
  is_pioneer: boolean
  pioneer_count: number
  id_verified_at?: string | null
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
  brand_new: { label: '🆕 มือหนึ่ง', cls: 'badge-brand-new' },
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
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${apiKey ? `&key=${apiKey}` : ''}`
    const r = await fetch(url)
    if (!r.ok) return null
    const d = await r.json()
    if (!d.items?.length) return null

    const info = d.items[0].volumeInfo
    const author = info.authors?.join(', ') || ''
    const raw_thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ''
    // Google Books ส่ง HTTP มา — upgrade เป็น HTTPS และเอา edge/zoom params ออก
    const cover_url = raw_thumb
      ? raw_thumb.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '').replace(/&zoom=\d+/g, '')
      : ''

    return {
      isbn,
      title: info.title || '',
      author,
      publisher: info.publisher || '',
      cover_url,
      language: info.language || 'th',
    }
  } catch {
    return null
  }
}
