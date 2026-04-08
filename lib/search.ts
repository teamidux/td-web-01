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

// Normalize สำหรับ compare แบบทนการสะกดต่างกัน:
// - lowercase + NFC (รวม Sara Am ทั้ง composed และ decomposed)
// - ตัด "พยัญชนะ + THANTHAKHAT (์)" คู่กัน — แก้ "แฮร์รี่" vs "แฮรี่" (ร์ = silent ร)
// - ตัด tone marks ที่เหลือ (mai ek/tho/tri/chattawa, nikhahit, yamakkan)
// - ตัด ๆ (mai yamok) และ ฯ (paiyannoi) — บางชื่อหนังสือใส่ บางเล่มไม่ใส่
// - ตัด whitespace — แก้ "คิดใหญ่ไม่คิดเล็ก" vs "คิดใหญ่ ไม่คิดเล็ก"
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\u0E01-\u0E2E]\u0E4C/g, '')
    .replace(/[\u0E48-\u0E4B\u0E4D\u0E4E]/g, '')
    .replace(/[\u0E2F\u0E46]/g, '')
    .replace(/\s+/g, '')
}

// Re-rank + filter: exact > prefix > substring > author.
// ใช้ normalizeForMatch ทั้ง 2 ฝั่งเพื่อทน Thai spelling variation
// (Google ส่ง fuzzy match บางทีไม่ตรง — กันแสดงเล่มที่ไม่เกี่ยว)
export function rankBooksByQuery<T extends { title?: string; author?: string }>(books: T[], query: string): T[] {
  const q = query.trim()
  if (!q) return books
  const qNorm = normalizeForMatch(q)
  if (!qNorm) return books

  return books
    .map(b => {
      const titleNorm = normalizeForMatch(b.title || '')
      const authorNorm = normalizeForMatch(b.author || '')

      let score = 0
      if (titleNorm === qNorm) score = 1000
      else if (titleNorm.startsWith(qNorm)) score = 500
      else if (titleNorm.includes(qNorm)) {
        const idx = titleNorm.indexOf(qNorm)
        score = 200 - Math.min(idx, 100)
      } else if (authorNorm.includes(qNorm)) {
        score = 50
      }
      return { ...b, _score: score }
    })
    .filter((b: any) => b._score > 0)
    .sort((a: any, b: any) => b._score - a._score)
    .map(({ _score, ...rest }: any) => rest)
}

// ตรวจว่า query มีตัวอักษรไทยหรือไม่ — ใช้ตัดสินว่าจะ langRestrict=th หรือไม่
function hasThaiChar(s: string): boolean {
  return /[\u0E00-\u0E7F]/.test(s)
}

// ขอ 1 หน้า (Google cap ~20 ต่อ request แม้ขอ maxResults=40 — ตรวจสอบกับ API จริงแล้ว)
async function callGoogleSearchPage(qParam: string, startIndex: number, langRestrict?: string): Promise<GoogleBook[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
  const params = new URLSearchParams({
    q: qParam,
    maxResults: '40',
    startIndex: String(startIndex),
    printType: 'books',
    orderBy: 'relevance',
  })
  if (langRestrict) params.set('langRestrict', langRestrict)
  if (apiKey) params.set('key', apiKey)
  const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) {
      console.warn('[Google Books]', r.status, 'q:', qParam, 'startIndex:', startIndex)
      return []
    }
    const d = await r.json()
    if (!d.items?.length) return []
    const out: GoogleBook[] = []
    for (const item of d.items) {
      const mapped = mapVolume(item)
      if (mapped) out.push(mapped)
    }
    return out
  } catch (err: any) {
    clearTimeout(t)
    console.error('[Google Books] error:', err?.message || err, 'startIndex:', startIndex)
    return []
  }
}

/**
 * ค้น Google Books — general search (intitle: ไม่ดีกับ Thai), re-rank ด้วย score เอง.
 * ดึง 3 หน้าขนานกัน (startIndex 0/20/40) เพื่อกวาดเล่มที่ Google ดัน rank ลงไปต่ำกว่า top 20
 * — ปัญหาคลาสสิกของหนังสือชุดเช่น Harry Potter ที่มีหลายเล่ม/หลายภาษา.
 *
 * IMPORTANT: ถ้า query มีตัวอักษรไทย เพิ่ม langRestrict=th — มิฉะนั้น Google
 * จะคืนผลตาม IP ของ caller (Vercel = US) ทำให้ได้แต่หนังสือที่ไม่เกี่ยวข้อง
 */
export async function fetchGoogleBooksByTitle(query: string, limit: number = 10): Promise<GoogleBook[]> {
  const lang = hasThaiChar(query) ? 'th' : undefined
  const pages = await Promise.all([
    callGoogleSearchPage(query, 0, lang),
    callGoogleSearchPage(query, 20, lang),
    callGoogleSearchPage(query, 40, lang),
  ])
  // Merge + dedupe by ISBN — เก็บ order ตาม Google relevance ก่อน rank ของเรา
  const seen = new Set<string>()
  const merged: GoogleBook[] = []
  for (const page of pages) {
    for (const b of page) {
      if (seen.has(b.isbn)) continue
      seen.add(b.isbn)
      merged.push(b)
    }
  }
  // Re-rank: exact > prefix > substring — แก้ปัญหา Google ไม่ค่อย rank Thai ถูก
  const ranked = rankBooksByQuery(merged, query)
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
