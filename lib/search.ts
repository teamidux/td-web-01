// Google Books API client — สำหรับ search หนังสือ + ดึง metadata
// Server-side only. ใช้ GOOGLE_BOOKS_API_KEY (หรือ NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY fallback)

export type GoogleBook = {
  isbn: string
  title: string
  author: string
  publisher?: string
  cover_url?: string
  language?: string
}

// แปลง ISBN-10 → ISBN-13
function isbn10to13(isbn10: string): string {
  const stem = '978' + isbn10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += parseInt(stem[i]) * (i % 2 === 0 ? 1 : 3)
  const check = (10 - (sum % 10)) % 10
  return stem + check
}

function extractISBN(info: any): string {
  const ids = info.industryIdentifiers || []
  const isbn13 = ids.find((id: any) => id.type === 'ISBN_13')?.identifier
  if (isbn13) return isbn13
  const isbn10 = ids.find((id: any) => id.type === 'ISBN_10')?.identifier
  if (isbn10 && /^\d{9}[\dX]$/.test(isbn10)) return isbn10to13(isbn10.slice(0, 9))
  return ''
}

function mapVolume(item: any): GoogleBook | null {
  const info = item.volumeInfo
  if (!info?.title) return null
  const isbn = extractISBN(info)
  if (!isbn) return null
  const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ''
  return {
    isbn,
    title: info.title,
    author: Array.isArray(info.authors) ? info.authors.join(', ') : '',
    publisher: info.publisher || '',
    cover_url: thumb
      ? thumb.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '').replace(/&zoom=\d+/g, '')
      : '',
    language: info.language || '',
  }
}

// Re-rank results: prefix match > substring > partial. Better than Google's
// own relevance for Thai (Google tokenizes Thai poorly).
export function rankBooksByQuery<T extends { title?: string; author?: string }>(books: T[], query: string): T[] {
  const q = query.toLowerCase().trim()
  if (!q) return books
  return books
    .map(b => {
      const title = (b.title || '').toLowerCase()
      const author = (b.author || '').toLowerCase()
      let score = 0
      if (title === q) score = 1000
      else if (title.startsWith(q)) score = 500
      else if (title.includes(q)) {
        // ใกล้ต้น title ยิ่งดี
        const idx = title.indexOf(q)
        score = 200 - Math.min(idx, 100)
      } else if (author.includes(q)) {
        score = 50
      }
      return { ...b, _score: score }
    })
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .map(({ _score, ...rest }: any) => rest)
}

async function callGoogleSearch(qParam: string, limit: number): Promise<GoogleBook[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
  const params = new URLSearchParams({
    q: qParam,
    maxResults: String(Math.min(40, Math.max(1, limit))),
    printType: 'books',
    orderBy: 'relevance',
  })
  if (apiKey) params.set('key', apiKey)
  const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) {
      console.warn('[Google Books]', r.status, 'q:', qParam)
      return []
    }
    const d = await r.json()
    if (!d.items?.length) return []
    const out: GoogleBook[] = []
    const seen = new Set<string>()
    for (const item of d.items) {
      const mapped = mapVolume(item)
      if (!mapped || seen.has(mapped.isbn)) continue
      seen.add(mapped.isbn)
      out.push(mapped)
      if (out.length >= limit) break
    }
    return out
  } catch (err: any) {
    clearTimeout(t)
    console.error('[Google Books] error:', err?.message || err)
    return []
  }
}

/**
 * ค้น Google Books — general search (intitle: ไม่ดีกับ Thai), re-rank ด้วย score เอง
 */
export async function fetchGoogleBooksByTitle(query: string, limit: number = 10): Promise<GoogleBook[]> {
  // ดึงผลเยอะกว่าที่ต้องการ — เผื่อ re-rank แล้วเลือก top
  const fetchSize = Math.min(40, Math.max(limit * 2, 20))
  const results = await callGoogleSearch(query, fetchSize)
  // Re-rank: prefix > substring > partial — แก้ปัญหา Google ไม่ค่อย rank Thai ถูก
  const ranked = rankBooksByQuery(results, query)
  return ranked.slice(0, limit)
}

/**
 * ดึงข้อมูลหนังสือเล่มเดียวจาก ISBN
 */
export async function fetchGoogleBookByISBN(isbn: string): Promise<GoogleBook | null> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${apiKey ? `&key=${apiKey}` : ''}`
    const r = await fetch(url, { next: { revalidate: 3600 } })
    if (!r.ok) return null
    const d = await r.json()
    if (!d.items?.length) return null
    return mapVolume(d.items[0])
  } catch {
    return null
  }
}
