import type { Metadata } from 'next'
import { AuthProvider } from '@/lib/auth'
import PwaInit from '@/components/PwaInit'
import LineBrowserBanner from '@/components/LineBrowserBanner'
import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

export const metadata: Metadata = {
  title: { default: 'BookMatch — ซื้อขายหนังสือมือสอง ราคาถูก ออนไลน์', template: '%s — BookMatch' },
  description: 'ตลาดหนังสือมือสองออนไลน์ ซื้อขายหนังสือเก่า ราคาถูก ค้นหาด้วย ISBN หรือชื่อหนังสือ เจอผู้ขายทันที ส่งทั่วไทย ลงขายฟรี ไม่มีค่าธรรมเนียม',
  keywords: 'หนังสือมือสอง, ซื้อหนังสือมือสอง, ขายหนังสือเก่า, ตลาดหนังสือ, หนังสือมือสอง ราคาถูก, หนังสือมือสอง ออนไลน์, ซื้อหนังสือ, ขายหนังสือ, รับซื้อหนังสือ, BookMatch, ISBN, หนังสือเก่า, หนังสือหายาก',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BookMatch' },
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: 'website',
    locale: 'th_TH',
    siteName: 'BookMatch',
    title: 'BookMatch — ซื้อขายหนังสือมือสอง ราคาถูก',
    description: 'ตลาดหนังสือมือสองออนไลน์ ซื้อขายหนังสือเก่า ราคาถูก ลงขายฟรี เจอผู้ขายทันที',
    // ไม่ต้องระบุ images — Next.js auto pick จาก app/opengraph-image.tsx
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BookMatch — ซื้อขายหนังสือมือสอง ราคาถูก',
    description: 'ตลาดหนังสือมือสองออนไลน์ ซื้อขายหนังสือเก่า ราคาถูก ลงขายฟรี เจอผู้ขายทันที',
    // ไม่ต้องระบุ images — Next.js auto pick จาก app/twitter-image.tsx
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
        <meta name="google-site-verification" content="O7-5eaJw-ZEB1eBHpDRHGuEx1uYfN0NVQrRogTiHuJc" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/api/icon?size=180" />
        <link rel="icon" type="image/png" sizes="192x192" href="/api/icon?size=192" />
        <link
          href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <LineBrowserBanner />
          {children}
        </AuthProvider>
        <PwaInit />
      </body>
    </html>
  )
}
