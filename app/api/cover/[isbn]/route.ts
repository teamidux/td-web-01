// Proxy book covers through our own domain.
// 1. Hides upstream source (no books.google.com URLs in DOM/network panel)
// 2. Bumps image quality (zoom=0 returns highest-res)
// 3. Browser + edge cached forever (immutable)
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const PLACEHOLDER_HEADERS = {
  'Content-Type': 'image/svg+xml',
  'Cache-Control': 'public, max-age=300',
}
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#F1F5F9"/><text x="100" y="160" font-size="80" text-anchor="middle" fill="#94A3B8">📗</text></svg>`

function bumpQuality(url: string): string {
  // remove edge curl + force zoom=0 (highest res Google serves publicly)
  let out = url.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '')
  if (/[?&]zoom=\d+/.test(out)) out = out.replace(/([?&])zoom=\d+/, '$1zoom=0')
  else out = out + (out.includes('?') ? '&' : '?') + 'zoom=0'
  return out
}

async function resolveCoverUrl(isbn: string): Promise<string | null> {
  // 1. Try our DB first (already cached from previous visits)
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data } = await supabase.from('books').select('cover_url').eq('isbn', isbn).maybeSingle()
    if (data?.cover_url) return data.cover_url
  } catch { /* fall through */ }

  // 2. Fall back to Google Books (no API key needed for ISBN search)
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
    const r = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${apiKey ? `&key=${apiKey}` : ''}`,
      { next: { revalidate: 86400 } }
    )
    if (!r.ok) return null
    const d = await r.json()
    const links = d.items?.[0]?.volumeInfo?.imageLinks
    return links?.large || links?.medium || links?.thumbnail || links?.smallThumbnail || null
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: { params: { isbn: string } }) {
  const isbn = decodeURIComponent(params.isbn)
  if (!/^\d{10,13}$/.test(isbn)) {
    return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
  }

  const rawUrl = await resolveCoverUrl(isbn)
  if (!rawUrl) {
    return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
  }

  try {
    const imgRes = await fetch(bumpQuality(rawUrl), {
      headers: { 'User-Agent': 'Mozilla/5.0 BookMatch' },
      next: { revalidate: 86400 },
    })
    if (!imgRes.ok || !imgRes.body) {
      return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
    }
    const buf = await imgRes.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response(PLACEHOLDER_SVG, { status: 200, headers: PLACEHOLDER_HEADERS })
  }
}
