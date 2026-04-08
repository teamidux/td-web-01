// Proxy book covers through our own domain.
// 1. Hides upstream source (no third-party URLs leak in the DOM/network panel)
// 2. Tries multiple sources: cached DB → Google Books → OpenLibrary
// 3. Browser + edge cached for 1 year on hits, 1 hour on misses
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const PLACEHOLDER_HEADERS = {
  'Content-Type': 'image/svg+xml',
  // misses: cache for an hour so we retry sources later (in case OpenLibrary
  // adds the cover after we first checked)
  'Cache-Control': 'public, max-age=3600',
}
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#F1F5F9"/><text x="100" y="160" font-size="80" text-anchor="middle" fill="#94A3B8">📗</text></svg>`

function bumpGoogleQuality(url: string): string {
  let out = url.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '')
  if (/[?&]zoom=\d+/.test(out)) out = out.replace(/([?&])zoom=\d+/, '$1zoom=0')
  else out = out + (out.includes('?') ? '&' : '?') + 'zoom=0'
  return out
}

// Fetch a URL and return ArrayBuffer if it actually returned an image
async function tryFetchImage(url: string): Promise<{ buf: ArrayBuffer; contentType: string } | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 BookMatch' },
      next: { revalidate: 86400 },
    })
    if (!r.ok) return null
    const contentType = r.headers.get('Content-Type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return null
    const buf = await r.arrayBuffer()
    // Reject "no cover" sentinel images (OpenLibrary returns ~800 byte gray rect)
    if (buf.byteLength < 1000) return null
    return { buf, contentType }
  } catch {
    return null
  }
}

// Source 1: cached cover URL from our books table
async function fromDB(isbn: string): Promise<string | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data } = await supabase.from('books').select('cover_url').eq('isbn', isbn).maybeSingle()
    return data?.cover_url || null
  } catch {
    return null
  }
}

// Source 2: Google Books API
async function fromGoogle(isbn: string): Promise<string | null> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
    const r = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${apiKey ? `&key=${apiKey}` : ''}`,
      { next: { revalidate: 86400 } }
    )
    if (!r.ok) return null
    const d = await r.json()
    const links = d.items?.[0]?.volumeInfo?.imageLinks
    return links?.extraLarge || links?.large || links?.medium || links?.thumbnail || links?.smallThumbnail || null
  } catch {
    return null
  }
}

// Source 3: OpenLibrary covers (good coverage for international + many Thai books)
function openLibraryUrl(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
}

export async function GET(_req: NextRequest, { params }: { params: { isbn: string } }) {
  const isbn = decodeURIComponent(params.isbn).replace(/[-\s]/g, '')
  if (!/^\d{10,13}$/.test(isbn)) {
    return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
  }

  // Try sources in order. Each returns either an image or null.
  // 1. DB-cached URL → bump quality if it's a Google URL → fetch
  const dbUrl = await fromDB(isbn)
  if (dbUrl) {
    const target = dbUrl.includes('books.google.com') ? bumpGoogleQuality(dbUrl) : dbUrl
    const hit = await tryFetchImage(target)
    if (hit) return imageResponse(hit)
  }

  // 2. Fresh Google Books lookup
  const googleUrl = await fromGoogle(isbn)
  if (googleUrl) {
    const hit = await tryFetchImage(bumpGoogleQuality(googleUrl))
    if (hit) return imageResponse(hit)
  }

  // 3. OpenLibrary fallback
  const olHit = await tryFetchImage(openLibraryUrl(isbn))
  if (olHit) return imageResponse(olHit)

  // No source had it
  return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
}

function imageResponse(hit: { buf: ArrayBuffer; contentType: string }): Response {
  return new Response(hit.buf, {
    status: 200,
    headers: {
      'Content-Type': hit.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
