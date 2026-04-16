// In-app notifications API
// GET: ดึง notifications ของ user (ล่าสุด 50 รายการ)
// POST: mark as read (body: { ids: string[] } หรือ { all: true })
//
// Security: ต้อง login + ดึงได้เฉพาะของตัวเอง

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = db()

  // ดึง notifications + unread count
  const [{ data: items }, { count: unreadCount }] = await Promise.all([
    sb.from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .not('type', 'in', '("new_book","book_name_report")')
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('type', 'in', '("new_book","book_name_report")')
      .is('read_at', null),
  ])

  return NextResponse.json({
    items: items || [],
    unread: unreadCount || 0,
  })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json()
  const sb = db()
  const now = new Date().toISOString()

  if (body.all) {
    // Mark all as read
    await sb.from('notifications')
      .update({ read_at: now })
      .eq('user_id', user.id)
      .is('read_at', null)
  } else if (body.ids?.length) {
    // Mark specific IDs as read — ต้องเป็นของ user เท่านั้น
    await sb.from('notifications')
      .update({ read_at: now })
      .eq('user_id', user.id)
      .in('id', body.ids)
      .is('read_at', null)
  }

  return NextResponse.json({ ok: true })
}
