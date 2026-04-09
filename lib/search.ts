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

// Re-rank: exact > prefix > substring > token-match > author > unrelated tail.
// ใช้ normalizeForMatch ทั้ง 2 ฝั่งเพื่อทน Thai spelling variation
// (Google ส่ง fuzzy match บางทีไม่ตรง — เราเอามาเรียงแทนการตัดทิ้ง
// เพราะตัดทิ้งทำให้ "พิมพ์ตรงแต่ไม่เจอ" เกิดบ่อยกับ Thai title ที่มีคำนำหน้า)
export function rankBooksByQuery<T extends { title?: string; author?: string }>(
  books: T[],
  query: string,
  opts: { dropUnrelated?: boolean } = {}
): T[] {
  const q = query.trim()
  if (!q) return books
  const qNorm = normalizeForMatch(q)
  if (!qNorm) return books

  // Token split — รองรับ multi-word query เช่น "ฮารูกิ มูราคามิ" หรือ "harry potter"
  // แต่ละ token > 1 char ถึงจะใช้ match (กัน noise จากตัวอักษรเดียว)
  const qTokens = q.split(/\s+/).map(t => normalizeForMatch(t)).filter(t => t.length >= 2)

  const scored = books.map(b => {
    const titleNorm = normalizeForMatch(b.title || '')
    const authorNorm = normalizeForMatch(b.author || '')

    let score = 0
    if (titleNorm === qNorm) score = 1000
    else if (titleNorm.startsWith(qNorm)) score = 500
    else if (titleNorm.includes(qNorm)) {
      const idx = titleNorm.indexOf(qNorm)
      score = 200 - Math.min(idx, 100)
    } else if (qTokens.length > 0) {
      // Token match — นับจำนวน token ที่อยู่ในชื่อหนังสือ
      let titleHits = 0
      let authorHits = 0
      for (const tok of qTokens) {
        if (titleNorm.includes(tok)) titleHits++
        if (authorNorm.includes(tok)) authorHits++
      }
      if (titleHits === qTokens.length) score = 150           // ทุก token เจอใน title
      else if (titleHits > 0) score = 80 + titleHits * 10     // บาง token
      else if (authorHits === qTokens.length) score = 60      // ทุก token ใน author
      else if (authorHits > 0) score = 30 + authorHits * 5
    } else if (authorNorm.includes(qNorm)) {
      score = 50
    }
    return { ...b, _score: score }
  })

  // ถ้า dropUnrelated=true (เช่น ใช้กับ UI search) ตัดเล่ม score=0 ออก
  // ถ้า false (เช่น cache pipeline) เก็บไว้ทั้งหมด
  const filtered = opts.dropUnrelated
    ? scored.filter((b: any) => b._score > 0)
    : scored

  return filtered
    .sort((a: any, b: any) => b._score - a._score)
    .map(({ _score, ...rest }: any) => rest)
}

// ขอ 1 หน้า (Google cap ~20 ต่อ request แม้ขอ maxResults=40 — ตรวจสอบกับ API จริงแล้ว).
// ถ้า GOOGLE_BOOKS_PROXY_URL set → call ผ่าน Thai proxy (real Thai IP) แทน
// เพื่อแก้ปัญหา Google geo-localize ตาม caller IP (Vercel = sin1 ≠ Thailand)
async function callGoogleSearchPage(qParam: string, startIndex: number): Promise<GoogleBook[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
  const proxyUrl = process.env.GOOGLE_BOOKS_PROXY_URL
  const proxyToken = process.env.GOOGLE_BOOKS_PROXY_TOKEN

  const params = new URLSearchParams({
    q: qParam,
    maxResults: '40',
    startIndex: String(startIndex),
    printType: 'books',
    orderBy: 'relevance',
    // projection=lite ลด response size ~50% — เราใช้แค่ title/author/isbn/cover/lang
    // ไม่ต้องการ description/categories/rating ใน search (detail page ดึง full ทีหลัง)
    projection: 'lite',
  })
  if (apiKey) params.set('key', apiKey)

  let url: string
  if (proxyUrl && proxyToken) {
    params.set('t', proxyToken)
    url = `${proxyUrl}?${params.toString()}`
  } else {
    url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`
  }

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
 * ดึงผลดิบจาก Google Books — ไม่มี filter ใช้กับ auto-cache pipeline
 * คืนทั้งหมดที่ Google ส่งมา (ปกติ ~40 เล่ม/call) เพื่อสะสม catalog
 * แม้เล่มไม่ตรง query ปัจจุบันก็อาจตรงกับ query อื่นในอนาคต
 */
export async function fetchGoogleBooksRaw(query: string): Promise<GoogleBook[]> {
  return callGoogleSearchPage(query, 0)
}

/**
 * ค้น Google Books — general search (intitle: ไม่ดีกับ Thai), re-rank ด้วย score เอง.
 * ดึงแค่ 1 หน้า (startIndex=0) เพื่อประหยัด Google API quota
 * (Free tier: 1,000 calls/day) ระยะยาว auto-cache จะทำให้ query ส่วนใหญ่
 * hit DB แทน Google ดังนั้น 1 หน้าก็พอสำหรับการ catch query ใหม่
 *
 * NOTE: ถ้าตั้ง GOOGLE_BOOKS_PROXY_URL → call ผ่าน Thai shared host proxy
 * (real Thai IP) ดู infra/books-proxy.php และคู่มือ deploy
 */
export async function fetchGoogleBooksByTitle(query: string, limit: number = 10): Promise<GoogleBook[]> {
  const books = await callGoogleSearchPage(query, 0)
  const ranked = rankBooksByQuery(books, query, { dropUnrelated: true })
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
