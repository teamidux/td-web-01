// Admin: SEO (Google Search Console) + ผู้ขายที่เข้ามาใหม่ในช่วงเวลา
// GET /api/tomga/seo?days=28
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'
import { gscQuery, gscResolveSite, gscServiceEmail, GscRow } from '@/lib/gsc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const fmt = (d: Date) => d.toISOString().slice(0, 10)
const r1 = (n: number) => Math.round(n * 10) / 10

type QueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number }
type PageRow = { page: string; clicks: number; impressions: number; ctr: number; position: number; queries: { query: string; clicks: number; impressions: number }[] }

function mapRow(r: GscRow) {
  return { clicks: r.clicks, impressions: r.impressions, ctr: r1(r.ctr * 100), position: r1(r.position) }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') || 28), 7), 480)

  // Search Console มีข้อมูลสมบูรณ์ช้า ~2 วัน
  const end = new Date(Date.now() - 2 * 86_400_000)
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  const range = { startDate: fmt(start), endDate: fmt(end) }

  // ── Google Search Console ──
  let gsc: Record<string, unknown>
  try {
    const site = await gscResolveSite()
    const [daily, queries, pages, qp] = await Promise.all([
      gscQuery({ ...range, dimensions: ['date'], rowLimit: 500 }),
      gscQuery({ ...range, dimensions: ['query'], rowLimit: 100 }),
      gscQuery({ ...range, dimensions: ['page'], rowLimit: 100 }),
      gscQuery({ ...range, dimensions: ['page', 'query'], rowLimit: 1000 }),
    ])
    const clicks = daily.reduce((s, r) => s + r.clicks, 0)
    const impressions = daily.reduce((s, r) => s + r.impressions, 0)
    const posW = daily.reduce((s, r) => s + r.position * r.impressions, 0)
    const byPage = new Map<string, PageRow>()
    for (const r of pages) byPage.set(r.keys[0], { page: r.keys[0].replace(/^https:\/\/bookmatch\.app/, ''), ...mapRow(r), queries: [] })
    for (const r of qp) {
      const p = byPage.get(r.keys[0])
      if (p) p.queries.push({ query: r.keys[1], clicks: r.clicks, impressions: r.impressions })
    }
    Array.from(byPage.values()).forEach(p => { p.queries = p.queries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 6) })
    gsc = {
      ok: true, site, range,
      summary: { clicks, impressions, ctr: impressions ? r1((clicks / impressions) * 100) : 0, position: impressions ? r1(posW / impressions) : 0 },
      daily: daily.map(r => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      queries: queries.map(r => ({ query: r.keys[0], ...mapRow(r) }) as QueryRow),
      pages: Array.from(byPage.values()),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    gsc = { ok: false, error: msg, service_email: gscServiceEmail(), range,
      hint: /gsc_no_access|gsc_403|gsc_401/.test(msg)
        ? 'เพิ่มอีเมล service account ด้านล่างเป็น user ใน Search Console (Settings → Users and permissions → Add user, สิทธิ์ Restricted) แล้วรีเฟรช'
        : 'เรียก Search Console ไม่สำเร็จ ดู error ด้านล่าง' }
  }

  // ── ผู้ขายที่ลงประกาศในช่วงนี้ (แยก "ใหม่" = ไม่เคยลงก่อนช่วงนี้) ──
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: ls } = await sb
    .from('listings')
    .select('seller_id, created_at, status, books(title), users!seller_id(display_name, created_at, line_user_id, facebook_id, phone_verified_at, seller_type, store_name)')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(2000)
  type L = { seller_id: string; created_at: string; status: string; books: { title: string } | null; users: Record<string, unknown> | null }
  const bySeller = new Map<string, { seller_id: string; name: string; channel: string; user_since: string | null; first_listing_at: string; listings: number; active: number; titles: string[]; store?: string | null }>()
  for (const raw of (ls || []) as unknown as L[]) {
    const u = raw.users || {}
    let s = bySeller.get(raw.seller_id)
    if (!s) {
      s = {
        seller_id: raw.seller_id,
        name: String(u.display_name || '(ไม่มีชื่อ)'),
        channel: u.line_user_id ? 'LINE' : u.facebook_id ? 'Facebook' : u.phone_verified_at ? 'เบอร์โทร' : 'ไม่ทราบ',
        user_since: (u.created_at as string) || null,
        first_listing_at: raw.created_at, listings: 0, active: 0, titles: [],
        store: u.seller_type === 'store' ? (u.store_name as string) || 'ร้าน' : null,
      }
      bySeller.set(raw.seller_id, s)
    }
    s.listings++
    if (raw.status === 'active') s.active++
    if (raw.books?.title && s.titles.length < 4) s.titles.push(raw.books.title)
  }
  // เคยลงก่อนช่วงนี้ไหม → returning
  const ids = Array.from(bySeller.keys())
  const returning = new Set<string>()
  if (ids.length) {
    const { data: prior } = await sb.from('listings').select('seller_id').in('seller_id', ids).lt('created_at', since).limit(5000)
    for (const p of prior || []) returning.add(p.seller_id)
  }
  const sellers = Array.from(bySeller.values())
    .map(s => ({ ...s, is_new: !returning.has(s.seller_id) }))
    .sort((a, b) => (a.first_listing_at < b.first_listing_at ? 1 : -1))

  return NextResponse.json({ days, gsc, sellers, sellers_new: sellers.filter(s => s.is_new).length })
}
