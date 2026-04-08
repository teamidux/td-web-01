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

// Read JPEG dimensions from header bytes (no decoding needed)
function jpegDimensions(buf: ArrayBuffer): { w: number; h: number } | null {
  const bytes = new Uint8Array(buf)
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 — start-of-frame markers
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6]
      const w = (bytes[i + 7] << 8) | bytes[i + 8]
      return { w, h }
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    i += 2 + segLen
  }
  return null
}

// Read PNG dimensions from header bytes
function pngDimensions(buf: ArrayBuffer): { w: number; h: number } | null {
  const bytes = new Uint8Array(buf)
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  return { w, h }
}

function isRealCover(buf: ArrayBuffer, contentType: string): boolean {
  // Real book covers are at least ~5KB. Placeholder/generic images from
  // OpenLibrary and Google Books generic thumbnails are usually 1-4KB.
  if (buf.byteLength < 5000) return false

  // Verify dimensions: real covers are ≥150px wide. OpenLibrary's "Vol N"
  // generic placeholder is ~130x195. Google's generic book icon is ~128x192.
  let dims: { w: number; h: number } | null = null
  if (contentType.includes('jpeg') || contentType.includes('jpg')) dims = jpegDimensions(buf)
  else if (contentType.includes('png')) dims = pngDimensions(buf)

  if (dims && dims.w < 150) return false
  return true
}

// Fetch a URL and return ArrayBuffer only if it's a real book cover
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
    if (!isRealCover(buf, contentType)) return null
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
