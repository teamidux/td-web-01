import type { Metadata } from 'next'
import { AuthProvider } from '@/lib/auth'
import PwaInit from '@/components/PwaInit'
import './globals.css'

export const metadata: Metadata = {
  title: 'BookMatch — ตลาดหนังสือมือสอง',
  description: 'ซื้อขายหนังสือมือสอง ค้นหาด้วย ISBN ง่ายและรวดเร็ว',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BookMatch' },
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
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
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
