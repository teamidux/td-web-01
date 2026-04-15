import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const VALID_REASONS = ['scam', 'fake_book', 'no_ship', 'inappropriate', 'other']

export async function POST(req: NextRequest) {
  try {
    const { reportedUserId, listingId, reason, details, website } = await req.json()
    // Honeypot
    if (website) return NextResponse.json({ ok: true })
    if (!reportedUserId || typeof reportedUserId !== 'string') {
      return NextResponse.json({ error: 'missing reportedUserId' }, { status: 400 })
    }
    // ใช้ session user แทน client-provided ID — กัน spoofing
    const { getSessionUser } = await import('@/lib/session')
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'must be logged in to report' }, { status: 401 })
    }
    const reporterUserId = sessionUser.id
    if (reportedUserId === reporterUserId) {
      return NextResponse.json({ error: 'cannot report yourself' }, { status: 400 })
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'invalid reason' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Rate limit: ไม่ให้ user คนเดียว spam รายงานคนเดิมเกิน 1 ครั้ง/วัน
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('reporter_user_id', reporterUserId)
      .eq('reported_user_id', reportedUserId)
      .gte('created_at', oneDayAgo)

    if ((count || 0) > 0) {
      return NextResponse.json({ error: 'already reported recently' }, { status: 429 })
    }

    const { error } = await supabase.from('reports').insert({
      reported_user_id: reportedUserId,
      reporter_user_id: reporterUserId,
      listing_id: listingId || null,
      reason,
      details: details?.toString().slice(0, 500) || null,
    })

    if (error) {
      console.error('[reports] db error:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
