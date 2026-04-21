// รายงานชื่อหนังสือไม่ถูกต้อง → เก็บลง book_reports ให้ admin review
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (!checkRateLimit(`report-name:${ip}`, 10, 3600_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { bookId, isbn, currentTitle, suggestedTitle } = await req.json()
  if (!suggestedTitle?.trim()) return NextResponse.json({ error: 'missing title' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { error } = await sb.from('book_reports').insert({
    book_id: bookId || null,
    isbn: isbn || null,
    field: 'title',
    current_value: currentTitle || null,
    suggested_value: suggestedTitle.trim(),
    reporter_id: user.id,
  })

  // Unique index (book_id, field) where status='pending' → error code 23505 = มีรายงานค้างอยู่แล้ว
  if (error && error.code === '23505') {
    return NextResponse.json({ ok: true, duplicate: true })
  }
  if (error) { console.error('[report-name] insert:', error); return NextResponse.json({ error: 'db_error' }, { status: 500 }) }

  return NextResponse.json({ ok: true })
}
