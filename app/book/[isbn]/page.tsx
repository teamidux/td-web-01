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
    .select('title, author, translator, cover_url, min_price, active_listings_count')
    .eq('isbn', isbn)
    .maybeSingle()
  return data
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const isbn = decodeURIComponent(params.isbn)
  const book = await getBook(isbn)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.vercel.app'

  if (!book) {
    return {
      title: `ISBN ${isbn} — BookMatch`,
      description: 'ค้นหาหนังสือมือสองราคาดีบน BookMatch',
    }
  }

  const priceText = book.min_price ? `ราคาเริ่มต้น ฿${book.min_price}` : 'มีขายมือสอง'
  const authorText = book.author ? ` โดย ${book.author}` : ''
  const translatorText = book.translator ? ` แปลโดย ${book.translator}` : ''
  const listingText = book.active_listings_count > 0
    ? ` · ${book.active_listings_count} คนกำลังขาย`
    : ''

  const title = `${book.title}${authorText} — BookMatch`
  const description = `ซื้อ "${book.title}"${authorText}${translatorText} มือสอง ${priceText}${listingText} | BookMatch ตลาดหนังสือมือสองออนไลน์`

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
      images: book.cover_url ? [{ url: book.cover_url, alt: book.title }] : [],
      type: 'website',
      locale: 'th_TH',
    },
    twitter: {
      card: 'summary',
      title: `${book.title} — BookMatch`,
      description,
      images: book.cover_url ? [book.cover_url] : [],
    },
  }
}

export default async function BookPage({ params }: PageProps) {
  const isbn = decodeURIComponent(params.isbn)
  const book = await getBook(isbn)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.vercel.app'

  const jsonLd = book ? {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: book.author ? { '@type': 'Person', name: book.author } : undefined,
    translator: book.translator ? { '@type': 'Person', name: book.translator } : undefined,
    isbn,
    image: book.cover_url || undefined,
    offers: book.active_listings_count > 0 ? {
      '@type': 'AggregateOffer',
      lowPrice: book.min_price || undefined,
      priceCurrency: 'THB',
      offerCount: book.active_listings_count,
      availability: 'https://schema.org/InStock',
      url: `${siteUrl}/book/${isbn}`,
    } : undefined,
  } : null

  return (
    <>
      {jsonLd && (
        <Script
          id="book-jsonld"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <BookDetailClient isbn={isbn} />
    </>
  )
}
