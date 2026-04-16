// Admin API: ลบ user
// POST /api/admin/user/delete { userId, mode: 'hard' | 'soft' }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser()
  if (!session || !isAdmin(session.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { userId, mode = 'hard' } = await req.json()
  if (!userId) return NextResponse.json({ error: 'missing userId' }, { status: 400 })
  if (userId === session.id) return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 })

  const sb = db()

  if (mode === 'soft') {
    const { error } = await sb.from('users').update({
      display_name: 'ผู้ใช้ที่ลบบัญชี',
      avatar_url: null, line_id: null, phone: null, store_name: null,
      deleted_at: new Date().toISOString(),
      deleted_reason: 'admin_soft_delete',
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: 'soft_delete_failed', message: error.message }, { status: 500 })
    await sb.from('listings').update({ status: 'removed' } as any).eq('seller_id', userId).eq('status', 'active')
    await sb.from('listings').update({ status: 'removed' } as any).eq('seller_id', userId).eq('status', 'sold')
    await sb.from('sessions').delete().eq('user_id', userId)
    return NextResponse.json({ ok: true, mode: 'soft' })
  }

  // === Hard Delete ===
  // หลังรัน FK migration แล้ว:
  // - contact_events.seller_id/buyer_id → ON DELETE SET NULL (auto)
  // - contact_events.listing_id → ON DELETE CASCADE (auto)
  // - contact_messages.user_id → ON DELETE SET NULL (auto)
  // - admin_actions.admin_id → ON DELETE SET NULL (auto)
  // ดังนั้นแค่ลบ tables ที่มี NOT NULL FK ก่อน แล้วลบ listings → users

  const errors: string[] = []

  // ลบ tables ที่ FK เป็น NOT NULL (on delete cascade ก็ลบ explicit ให้ชัวร์)
  const tables = [
    { table: 'notifications', col: 'user_id' },
    { table: 'push_subscriptions', col: 'user_id' },
    { table: 'phone_changes_log', col: 'user_id' },
    { table: 'phone_otps', col: 'user_id' },
    { table: 'sessions', col: 'user_id' },
    { table: 'wanted', col: 'user_id' },
    { table: 'wanted_notifications', col: 'user_id' },
    { table: 'search_logs', col: 'user_id' },
    { table: 'id_verifications', col: 'user_id' },
    { table: 'reports', col: 'reported_user_id' },
  ]

  for (const { table, col } of tables) {
    const { error } = await sb.from(table).delete().eq(col, userId)
    if (error) errors.push(`${table}: ${error.message}`)
  }

  // ลบ listings (contact_events.listing_id CASCADE จะลบตาม)
  const { error: listErr } = await sb.from('listings').delete().eq('seller_id', userId)
  if (listErr) errors.push(`listings: ${listErr.message}`)

  // ลบ user (contact_events.seller_id/buyer_id SET NULL อัตโนมัติ)
  const { error: userErr } = await sb.from('users').delete().eq('id', userId)
  if (userErr) {
    return NextResponse.json({
      error: 'delete_user_failed',
      message: userErr.message,
      sub_errors: errors,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode: 'hard', warnings: errors.length > 0 ? errors : undefined })
}
