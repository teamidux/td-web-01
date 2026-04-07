import type { Metadata } from 'next'
import { AuthProvider } from '@/lib/auth'
import PwaInit from '@/components/PwaInit'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.vercel.app'

export const metadata: Metadata = {
  title: { default: 'BookMatch — ตลาดหนังสือมือสอง', template: '%s — BookMatch' },
  description: 'ซื้อขายหนังสือมือสองออนไลน์ ค้นหาด้วย ISBN หรือชื่อหนังสือ เจอผู้ขายได้ทันที',
  keywords: 'หนังสือมือสอง, ซื้อหนังสือ, ขายหนังสือ, BookMatch, ISBN',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BookMatch' },
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: 'website',
    locale: 'th_TH',
    siteName: 'BookMatch',
    title: 'BookMatch — ตลาดหนังสือมือสอง',
    description: 'ซื้อขายหนังสือมือสองออนไลน์ ค้นหาด้วย ISBN หรือชื่อหนังสือ เจอผู้ขายได้ทันที',
  },
  twitter: {
    card: 'summary',
    title: 'BookMatch — ตลาดหนังสือมือสอง',
    description: 'ซื้อขายหนังสือมือสองออนไลน์ ค้นหาด้วย ISBN หรือชื่อหนังสือ เจอผู้ขายได้ทันที',
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <head>
        <meta name="theme-color" content="#2563eb" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/api/icon?size=180" />
        <link rel="icon" type="image/png" sizes="192x192" href="/api/icon?size=192" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <PwaInit />
      </body>
    </html>
  )
}
