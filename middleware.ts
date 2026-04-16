import { NextRequest, NextResponse } from 'next/server'

// กัน direct API access จากภายนอก (scraper, curl, bot)
// request จากเว็บเรา (browser) จะมี Origin/Referer header อัตโนมัติ
// request จาก script ภายนอกจะไม่มี → block

const ALLOWED_ORIGINS = [
  'https://bookmatch.app',
  'https://www.bookmatch.app',
  'http://localhost:3000',
  'http://localhost:3001',
]

// API routes ที่ต้องป้องกัน (public data)
const PROTECTED_PATTERNS = [
  '/api/listings',
  '/api/search',
  '/api/users/',
  '/api/cover/',
  '/api/books/view',
]

// API routes ที่ต้อง allow จากภายนอก (OAuth callback, webhook)
const EXEMPT_PATTERNS = [
  '/api/auth/',
  '/api/line/',
  '/api/push/',
  '/api/cron/',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // เฉพาะ /api/* routes
  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // Exempt routes (OAuth, webhook)
  if (EXEMPT_PATTERNS.some(p => pathname.startsWith(p))) return NextResponse.next()

  // เช็คว่าเป็น protected route ไหม
  if (!PROTECTED_PATTERNS.some(p => pathname.startsWith(p))) return NextResponse.next()

  // GET requests เท่านั้นที่ต้องเช็ค (POST มี auth อยู่แล้ว)
  if (req.method !== 'GET') return NextResponse.next()

  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''

  // ถ้ามี Origin หรือ Referer จาก domain เรา → ผ่าน
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o))
  if (isAllowed) return NextResponse.next()

  // Server-side fetch (Next.js SSR) ไม่มี Origin — เช็ค user-agent
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  if (ua.includes('next.js') || ua.includes('node-fetch') || ua.includes('undici')) return NextResponse.next()

  // ไม่มี Origin + ไม่ใช่ SSR → น่าจะเป็น scraper/curl
  // ยังให้ผ่านแต่ใส่ header บอกว่าถูก flag (ไม่ hard block เพราะอาจ false positive)
  const res = NextResponse.next()
  res.headers.set('X-BM-Flagged', '1')
  return res
}

export const config = {
  matcher: '/api/:path*',
}
