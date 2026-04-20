import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

// กัน direct API access + scraping catalog pages
// 1) API routes: ต้องมี Origin/Referer จาก domain เรา (กัน curl/bot ภายนอก)
// 2) Book/search pages: rate limit ต่อ IP (กัน scraper ดึง catalog)

const ALLOWED_ORIGINS = [
  'https://bookmatch.app',
  'https://www.bookmatch.app',
  'http://localhost:3000',
  'http://localhost:3001',
]

const PROTECTED_PATTERNS = [
  '/api/listings',
  '/api/search',
  '/api/users/',
  '/api/cover/',
  '/api/books/view',
]

const EXEMPT_PATTERNS = [
  '/api/auth/',
  '/api/line/',
  '/api/push/',
  '/api/cron/',
]

// Well-known search engine crawlers — allow ผ่านโดยไม่ rate limit
// (เราอยาก Google/Bing crawl เยอะๆ เพื่อ SEO)
const SEARCH_BOT_UA_REGEX = /googlebot|bingbot|duckduckbot|yandexbot|baiduspider|applebot|facebookexternalhit|twitterbot|linkedinbot/i

// Known aggressive scrapers / AI crawlers — block เลย (ตรงกับ robots.txt)
const BLOCKED_UA_REGEX = /gptbot|claude-web|claudebot|ccbot|anthropic-ai|chatgpt-user|perplexitybot|scrapy|python-requests|httpx|curl\//i

function apiGuard(req: NextRequest, pathname: string): NextResponse | null {
  if (EXEMPT_PATTERNS.some(p => pathname.startsWith(p))) return null
  if (!PROTECTED_PATTERNS.some(p => pathname.startsWith(p))) return null
  if (req.method !== 'GET') return null

  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o))
  if (isAllowed) return null

  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  if (ua.includes('next.js') || ua.includes('node-fetch') || ua.includes('undici')) return null

  const res = NextResponse.next()
  res.headers.set('X-BM-Flagged', '1')
  return res
}

function pageGuard(req: NextRequest, pathname: string): NextResponse | null {
  // Protect book detail + search pages จาก scraping
  if (!pathname.startsWith('/book/') && !pathname.startsWith('/search')) return null
  if (req.method !== 'GET') return null

  const ua = req.headers.get('user-agent') || ''

  // Block aggressive scraper UAs ทันที
  if (BLOCKED_UA_REGEX.test(ua)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Allow search engine bots (need to index)
  if (SEARCH_BOT_UA_REGEX.test(ua)) return null

  // Rate limit ต่อ IP — 60 requests/min (สูงพอสำหรับคนดูหนังสือปกติ
  // คน browse เยอะๆก็ไม่เกิน; scraper ที่ดึง 50K เล่มจะเจอ)
  const ip = getClientIp(req)
  if (!checkRateLimit(`pg:${ip}`, 60, 60_000)) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  }
  return null
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Guard 1: API routes (existing)
  if (pathname.startsWith('/api/')) {
    const apiRes = apiGuard(req, pathname)
    if (apiRes) return apiRes
    return NextResponse.next()
  }

  // Guard 2: Catalog pages (new — scraping protection)
  const pageRes = pageGuard(req, pathname)
  if (pageRes) return pageRes

  return NextResponse.next()
}

// Match API + catalog pages (book detail + search)
export const config = {
  matcher: ['/api/:path*', '/book/:path*', '/search/:path*'],
}
