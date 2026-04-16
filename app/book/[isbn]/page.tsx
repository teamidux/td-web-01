import { Metadata } from 'next'
import Script from 'next/script'
import BookDetailClient from './BookDetailClient'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface PageProps {
  params: { isbn: string }
}

async function getBook(isbn: string) {
  const { data } = await supabase
    .from('books')
    .select('*, min_price, active_listings_count')
    .eq('isbn', isbn)
    .maybeSingle()
  if (data) return data

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
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const isbn = decodeURIComponent(params.isbn)
  const book = await getBook(isbn)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

  if (!book) {
    return {
      title: `ISBN ${isbn} — BookMatch`,
      description: 'ค้นหาหนังสือมือสองราคาดีบน BookMatch',
    }
  }

  const priceText = book.min_price ? `ราคาเริ่มต้น ฿${book.min_price}` : ''
  const authorText = book.author ? ` โดย ${book.author}` : ''
  const translatorText = book.translator ? ` แปลโดย ${book.translator}` : ''
  const listingText = book.active_listings_count > 0
    ? `${book.active_listings_count} คนกำลังขาย`
    : ''

  const title = `${book.title} มือสอง${authorText} — ซื้อขายราคาถูก | BookMatch`
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

  // Schema.org: ใส่ทั้ง Product (Google Shopping) + Book (Google Books)
  const jsonLd = book ? [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: book.title,
      description: `${book.title}${book.author ? ` โดย ${book.author}` : ''} — หนังสือมือสอง`,
      image: book.cover_url ? (book.cover_url.includes('supabase.co') ? book.cover_url : `${siteUrl}/api/cover/${isbn}`) : `${siteUrl}/api/cover/${isbn}`,
      brand: { '@type': 'Brand', name: book.author || 'BookMatch' },
      isbn,
      category: 'หนังสือ',
      offers: book.active_listings_count > 0 ? {
        '@type': 'AggregateOffer',
        lowPrice: book.min_price || undefined,
        highPrice: undefined,
        priceCurrency: 'THB',
        offerCount: book.active_listings_count,
        availability: 'https://schema.org/InStock',
        url: `${siteUrl}/book/${isbn}`,
      } : {
        '@type': 'Offer',
        availability: 'https://schema.org/OutOfStock',
        priceCurrency: 'THB',
        url: `${siteUrl}/book/${isbn}`,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Book',
      name: book.title,
      author: book.author ? { '@type': 'Person', name: book.author } : undefined,
      isbn,
      image: book.cover_url || undefined,
    },
  ] : null

  return (
    <>
      {jsonLd && jsonLd.map((ld, i) => (
        <Script
          key={i}
          id={`book-jsonld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }}
        />
      ))}
      <BookDetailClient isbn={isbn} initialBook={book} />
    </>
  )
}
