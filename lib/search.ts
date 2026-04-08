export type GoogleBook = {
  isbn: string
  title: string
  author: string
  publisher?: string
  cover_url?: string
  language?: string
}

// แปลง ISBN-10 → ISBN-13 (ใช้ prefix 978 + checksum mod 10)
function isbn10to13(isbn10: string): string {
  const stem = '978' + isbn10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += parseInt(stem[i]) * (i % 2 === 0 ? 1 : 3)
  }
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
    author: info.authors?.join(', ') || '',
    publisher: info.publisher || '',
    cover_url: thumb ? thumb.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '').replace(/&zoom=\d+/g, '') : '',
    language: info.language || '',
  }
}

// OpenLibrary fallback — coverage ต่างจาก Google (มี edition ที่ Google ไม่มี)
export async function fetchOpenLibraryByQuery(query: string, limit: number = 10): Promise<GoogleBook[]> {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!r.ok) return []
    const d = await r.json()
    const docs = d.docs || []
    return docs
      .map((doc: any): GoogleBook | null => {
        const isbnList = Array.isArray(doc.isbn) ? doc.isbn : []
        // เลือก ISBN-13 ก่อน, fallback ISBN-10 → แปลง 13
        let isbn = isbnList.find((i: string) => /^\d{13}$/.test(i))
        if (!isbn) {
          const isbn10 = isbnList.find((i: string) => /^\d{9}[\dX]$/.test(i))
          if (isbn10) isbn = isbn10to13(isbn10.slice(0, 9))
        }
        if (!isbn || !doc.title) return null
        const coverId = doc.cover_i
        return {
          isbn,
          title: doc.title,
          author: Array.isArray(doc.author_name) ? doc.author_name.join(', ') : '',
          publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : '',
          cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
          language: Array.isArray(doc.language) ? doc.language[0] : '',
        }
      })
      .filter(Boolean) as GoogleBook[]
  } catch {
    return []
  }
}

/**
 * ค้น Google Books — เน้นหนังสือไทย
 * - ไม่ใช้ intitle: (จำกัดเกินไป)
 * - langRestrict=th (แต่ Google มักไม่ strict ก็ถือว่าฮินต์ priority)
 * - printType=books (ตัด magazine/journal)
 * - รับ ISBN-10 ด้วย แปลงเป็น 13
 */
export async function fetchGoogleBooksByTitle(query: string, limit: number = 5): Promise<GoogleBook[]> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
    const maxResults = Math.min(40, Math.max(1, limit))
    // ลองยิง 2 query คู่ขนาน: 1) เน้น Thai 2) ทั่วไป — แล้วรวมผล
    const base = `https://www.googleapis.com/books/v1/volumes?printType=books&maxResults=${maxResults}${apiKey ? `&key=${apiKey}` : ''}`
    const urls = [
      `${base}&q=${encodeURIComponent(query)}&langRestrict=th`,
      `${base}&q=${encodeURIComponent(query)}`,
    ]
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const responses = await Promise.allSettled(
      urls.map(u => fetch(u, { signal: controller.signal }).then(r => r.ok ? r.json() : null))
    )
    clearTimeout(timeout)

    const seen = new Set<string>()
    const results: GoogleBook[] = []
    for (const res of responses) {
      if (res.status !== 'fulfilled' || !res.value?.items) continue
      for (const item of res.value.items) {
        const mapped = mapVolume(item)
        if (!mapped) continue
        if (seen.has(mapped.isbn)) continue
        seen.add(mapped.isbn)
        results.push(mapped)
        if (results.length >= limit) break
      }
      if (results.length >= limit) break
    }
    return results
  } catch {
    return []
  }
}

// Map ตัวเลขอารบิก → คำไทย และกลับกัน
const ARABIC_TO_THAI: Record<string, string> = {
  '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม',
  '4': 'สี่', '5': 'ห้า', '6': 'หก', '7': 'เจ็ด',
  '8': 'แปด', '9': 'เก้า',
}
const THAI_TO_ARABIC: Array<[RegExp, string]> = [
  [/ศูนย์/g, '0'], [/หนึ่ง/g, '1'], [/สอง/g, '2'], [/สาม/g, '3'],
  [/สี่/g, '4'], [/ห้า/g, '5'], [/หก/g, '6'], [/เจ็ด/g, '7'],
  [/แปด/g, '8'], [/เก้า/g, '9'],
]

// Normalize สระสั้น → สระยาว: ิ→ี  ุ→ู  ึ→ื
function vowelShortToLong(s: string): string {
  return s.replace(/\u0E34/g, '\u0E35').replace(/\u0E38/g, '\u0E39').replace(/\u0E36/g, '\u0E37')
}
// Normalize สระยาว → สระสั้น: ี→ิ  ู→ุ  ื→ึ
function vowelLongToShort(s: string): string {
  return s.replace(/\u0E35/g, '\u0E34').replace(/\u0E39/g, '\u0E38').replace(/\u0E37/g, '\u0E36')
}

/**
 * Normalize Thai unicode — แก้ปัญหา composed vs decomposed sara am.
 *
 * U+0E33 (ำ SARA AM) เทียบเท่ากับ U+0E4D (◌ํ NIKHAHIT) + U+0E32 (า SARA AA)
 * แต่ ILIKE/PostgreSQL เปรียบเทียบ byte-by-byte → ไม่ match กัน
 *
 * Google Books มักส่ง decomposed form (◌ํา) — ต้องแปลงให้ composed (ำ)
 * เพื่อให้ search หาเจอ
 */
export function normalizeThai(s: string): string {
  if (!s) return s
  return s.replace(/\u0E4D\u0E32/g, '\u0E33')
}

/**
 * สร้าง query variants เพื่อ fuzzy search:
 * - ตัวเลขอารบิก ↔ คำไทย  (4 ↔ สี่)
 * - มีช่องว่าง / ไม่มีช่องว่าง
 * - สระสั้น ↔ สระยาว  (ทิม ↔ ทีม)
 */
export function searchVariants(q: string): string[] {
  const base = q.trim().replace(/\s+/g, ' ')
  const set = new Set<string>()

  const add = (s: string) => {
    const t = s.trim()
    if (t.length >= 1) {
      set.add(t)
      // เพิ่มแบบไม่มี space ถ้าต่างจากต้นฉบับ
      const noSpace = t.replace(/\s/g, '')
      if (noSpace !== t) set.add(noSpace)
    }
  }

  add(base)

  // สระสั้น ↔ สระยาว (เช่น "ทิม" → "ทีม", "ทีม" → "ทิม")
  const shortToLong = vowelShortToLong(base)
  if (shortToLong !== base) add(shortToLong)
  const longToShort = vowelLongToShort(base)
  if (longToShort !== base) add(longToShort)

  // อารบิก → ไทย (เช่น "4 แผ่นดิน" → "สี่ แผ่นดิน" → "สี่แผ่นดิน")
  const toThai = base.replace(/[0-9]/g, d => ARABIC_TO_THAI[d] ?? d)
  if (toThai !== base) add(toThai)

  // ไทย → อารบิก (เช่น "สี่แผ่นดิน" → "4แผ่นดิน")
  let toArabic = base
  for (const [re, digit] of THAI_TO_ARABIC) toArabic = toArabic.replace(re, digit)
  if (toArabic !== base) add(toArabic)

  // กรณี toThai มี space ต้องลอง toThai ไม่มี space ด้วย
  if (toThai !== base) {
    let tt = toThai
    for (const [re, digit] of THAI_TO_ARABIC) tt = tt.replace(re, digit)
    if (tt !== toThai) add(tt)
  }

  return Array.from(set)
}

/**
 * สร้าง Supabase .or() string จาก variants
 * columns: title, author, alt_titles (user-contributed Thai aliases)
 */
export function buildOrFilter(variants: string[], columns = ['title', 'author', 'alt_titles']): string {
  return variants
    .flatMap(v => columns.map(col => `${col}.ilike.%${v}%`))
    .join(',')
}
