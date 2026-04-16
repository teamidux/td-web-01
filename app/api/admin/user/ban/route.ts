// Admin API: Ban / Unban user
// POST /api/admin/user/ban { userId, action: 'ban' | 'unban', reason? }

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

  const { userId, action, reason } = await req.json()
  if (!userId || !['ban', 'unban'].includes(action)) {
    return NextResponse.json({ error: 'invalid params' }, { status: 400 })
  }
  if (userId === session.id) {
    return NextResponse.json({ error: 'cannot_ban_self' }, { status: 400 })
  }

  const sb = db()

  if (action === 'ban') {
    // 1. Mark user as banned
    const { error } = await sb.from('users').update({
      banned_at: new Date().toISOString(),
      banned_reason: reason || null,
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: 'ban_failed', message: error.message }, { status: 500 })

    // 2. ซ่อน listings — ใช้ raw SQL กัน check constraint re-validation
    await sb.rpc('exec_sql', {
      query: `update listings set status = 'removed' where seller_id = '${userId}' and status != 'removed'`
    }).then(() => {}).catch(async () => {
      // fallback ถ้า exec_sql ไม่มี — ลอง update ทีละ status
      await sb.from('listings').update({ status: 'removed' } as any).eq('seller_id', userId).eq('status', 'active')
      await sb.from('listings').update({ status: 'removed' } as any).eq('seller_id', userId).eq('status', 'sold')
      await sb.from('listings').update({ status: 'removed' } as any).eq('seller_id', userId).eq('status', 'reserved')
    })

    // 3. เตะออกจากทุก session
    await sb.from('sessions').delete().eq('user_id', userId)

    return NextResponse.json({ ok: true, action: 'ban' })
  }

  // Unban
  const { error } = await sb.from('users').update({
    banned_at: null,
    banned_reason: null,
  }).eq('id', userId)
  if (error) return NextResponse.json({ error: 'unban_failed', message: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, action: 'unban' })
}
