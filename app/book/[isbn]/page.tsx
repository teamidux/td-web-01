import { Metadata } from 'next'
import { cache } from 'react'
import { generateBookDescription, isDescriptionEnabled } from '@/lib/book-description'
import BookDetailClient from './BookDetailClient'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
// service role — ใช้เฉพาะเขียน books.description (RLS กัน anon เขียน)
const admin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

// "เกี่ยวกับหนังสือ" — สร้างครั้งแรกที่มีคนเปิดหน้า (รวม crawler) แล้วเก็บลง DB ครั้งต่อไปอ่านจาก DB
// description = null → ยังไม่เคยลอง, '' → ลองแล้วโมเดลไม่มีอะไรจะเขียน (ไม่ลองซ้ำ)
async function ensureDescription(book: {
  id: string; title: string; author?: string | null; translator?: string | null; publisher?: string | null
  category?: string | null; publish_year?: number | null; language?: string | null
}): Promise<string | null> {
  if (!admin || !isDescriptionEnabled()) return null
  try {
    const { data: ls } = await admin.from('listings').select('notes').eq('book_id', book.id).eq('status', 'active').limit(3)
    const desc = await generateBookDescription({ ...book, notes: (ls || []).map((l: { notes: string | null }) => l.notes || '') })
    await admin.from('books').update({ description: desc }).eq('id', book.id)
    return desc || null
  } catch (e) {
    console.warn('[book] describe failed:', e instanceof Error ? e.message : e)
    return null
  }
}

interface PageProps {
  params: { isbn: string }
}

// Force dynamic — กัน Next.js cache ทำให้ admin update cover/title ไม่ขึ้น
export const dynamic = 'force-dynamic'
export const revalidate = 0

// cache() = เรียกครั้งเดียวต่อ request แม้ generateMetadata และ page เรียกทั้งคู่
const getBook = cache(async (isbn: string) => {
  const { data } = await supabase
    .from('books')
    .select('*, min_price, active_listings_count')
    .eq('isbn', isbn)
    .maybeSingle()
  if (data) {
    if (data.description == null && data.id) data.description = await ensureDescription(data)
    return data
  }

  // ดึงจาก Google Books — cache ที่ Next.js edge 1 ชั่วโมง (ไม่ write DB)
  // หนังสือจะลง DB เฉพาะตอน user list/wantlist (ผ่าน flow ของหน้านั้นๆ)
  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${apiKey ? `&key=${apiKey}` : ''}`
    const r = await fetch(url, { next: { revalidate: 3600 } })
    if (!r.ok) return null
    const d = await r.json()
    if (!d.items?.length) return null
    const info = d.items[0].volumeInfo
    const sale = d.items[0].saleInfo
    const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ''
    const cover_url = thumb ? thumb.replace(/^http:\/\//, 'https://').replace(/&edge=\w+/g, '').replace(/&zoom=\d+/g, '') : ''
    const lp = sale?.listPrice
    const list_price = (lp && lp.currencyCode === 'THB') ? Math.round(lp.amount) : null

    return {
      title: info.title || '',
      author: info.authors?.join(', ') || '',
      publisher: info.publisher || '',
      cover_url,
      language: info.language || 'th',
      category: info.categories?.[0] || null,
      list_price,
      active_listings_count: 0,
      min_price: null,
    }
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const isbn = decodeURIComponent(params.isbn)
  const book = await getBook(isbn)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

  if (!book) {
    // ไม่พบหนังสือ → ไม่ให้ index (กัน soft-404 / หน้าว่างเข้า Google)
    return {
      title: `ISBN ${isbn}`,
      description: 'ค้นหาหนังสือมือสองราคาดีบน BookMatch',
      robots: { index: false, follow: false },
    }
  }

  const priceText = book.min_price ? `ราคาเริ่มต้น ฿${book.min_price}` : ''
  const authorText = book.author ? ` โดย ${book.author}` : ''
  const translatorText = book.translator ? ` แปลโดย ${book.translator}` : ''
  const listingText = book.active_listings_count > 0
    ? `${book.active_listings_count} คนกำลังขาย`
    : ''

  // layout มี template '%s — BookMatch' อยู่แล้ว → ห้ามเติมชื่อเว็บซ้ำตรงนี้
  const title = `${book.title} มือสอง${authorText} — ซื้อขายราคาถูก`
  const description = `ซื้อ "${book.title}"${authorText}${translatorText} หนังสือมือสอง ${priceText ? priceText + ' ' : ''}${listingText ? listingText + ' ' : ''}ราคาถูก ส่งทั่วไทย | BookMatch ตลาดหนังสือมือสองออนไลน์`

  return {
    title,
    description,
    keywords: [book.title, book.author, `ISBN ${isbn}`, 'หนังสือมือสอง', 'ซื้อหนังสือ', 'BookMatch'].filter(Boolean).join(', '),
    alternates: {
      canonical: `${siteUrl}/book/${isbn}`,
    },
    openGraph: {
      title: `${book.title}${authorText}`,
      description,
      url: `${siteUrl}/book/${isbn}`,
      siteName: 'BookMatch',
      // ใช้รูปปกหนังสือถ้ามี — ไม่งั้น Next.js auto fallback ไป app/opengraph-image.tsx
      ...(book.cover_url && { images: [{ url: book.cover_url, alt: book.title }] }),
      type: 'website',
      locale: 'th_TH',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${book.title} — BookMatch`,
      description,
      ...(book.cover_url && { images: [book.cover_url] }),
    },
  }
}

export default async function BookPage({ params }: PageProps) {
  const isbn = decodeURIComponent(params.isbn)
  const book = await getBook(isbn)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

  // ราคาจริงจาก listings ที่ active — ใช้ทำ AggregateOffer (lowPrice/highPrice)
  // Google บังคับว่า offers ต้องมี price → ถ้าไม่มีคนขาย = ไม่ใส่ offers/Product เลย
  let priceRange: { low: number; high: number; count: number } | null = null
  if (book?.id && (book.active_listings_count || 0) > 0) {
    const { data: ls } = await supabase
      .from('listings')
      .select('price')
      .eq('book_id', book.id)
      .eq('status', 'active')
      .gt('price', 0)
    const prices = (ls || []).map((l: any) => Number(l.price)).filter((n: number) => Number.isFinite(n) && n > 0)
    if (prices.length) {
      priceRange = { low: Math.min(...prices), high: Math.max(...prices), count: prices.length }
    }
  }

  const pageUrl = `${siteUrl}/book/${isbn}`
  const imageUrl = book?.cover_url
    ? (book.cover_url.includes('supabase.co') ? book.cover_url : `${siteUrl}/api/cover/${isbn}`)
    : undefined

  // Schema.org — Book เสมอ (ข้อมูลบรรณานุกรม) + Product/AggregateOffer เฉพาะตอนมีคนขายจริง
  // ห้ามใส่ offers ที่ไม่มี price (Search Console: "Either price or priceSpecification.price should be specified")
  const bookLd = book ? {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': `${pageUrl}#book`,
    name: book.title,
    url: pageUrl,
    ...(book.author && { author: { '@type': 'Person', name: book.author } }),
    ...(book.translator && { translator: { '@type': 'Person', name: book.translator } }),
    ...(book.publisher && { publisher: { '@type': 'Organization', name: book.publisher } }),
    ...(book.publish_year && { datePublished: String(book.publish_year) }),
    ...(book.language && { inLanguage: book.language }),
    ...(/^\d{10}(\d{3})?$/.test(isbn) && { isbn }),
    ...(imageUrl && { image: imageUrl }),
    ...(book.description && { description: book.description }),
  } : null

  const productLd = book && priceRange ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${pageUrl}#product`,
    name: book.title,
    description: book.description || `${book.title}${book.author ? ` โดย ${book.author}` : ''} — หนังสือมือสอง`,
    ...(imageUrl && { image: imageUrl }),
    ...(/^\d{10}(\d{3})?$/.test(isbn) && { isbn, gtin13: isbn.length === 13 ? isbn : undefined }),
    category: 'หนังสือ',
    isRelatedTo: { '@id': `${pageUrl}#book` },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'THB',
      lowPrice: priceRange.low,
      highPrice: priceRange.high,
      offerCount: priceRange.count,
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition',
      url: pageUrl,
    },
  } : null

  const jsonLd = [bookLd, productLd].filter(Boolean)

  return (
    <>
      {/* inline <script> ธรรมดา (ไม่ใช่ next/script) → อยู่ใน SSR HTML ให้ crawler อ่านได้ทันที */}
      {jsonLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }}
        />
      ))}
      <BookDetailClient isbn={isbn} initialBook={book} />
    </>
  )
}
