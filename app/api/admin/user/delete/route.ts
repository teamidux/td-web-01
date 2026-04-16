// Admin API: ลบ user
// POST /api/admin/user/delete { userId, mode: 'hard' | 'soft' }
//
// hard: ลบทุกอย่างหมด (สำหรับ test data) — ใช้ raw SQL bypass RLS + FK
// soft: ซ่อนข้อมูลส่วนตัว แต่เก็บ listings/events เป็นหลักฐาน (production)

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
    await sb.from('listings').update({ status: 'removed' }).eq('seller_id', userId).eq('status', 'active')
    await sb.from('sessions').delete().eq('user_id', userId)
    return NextResponse.json({ ok: true, mode: 'soft' })
  }

  // === Hard Delete: ใช้ raw SQL ครั้งเดียว bypass RLS + FK ===
  const { error } = await sb.rpc('admin_hard_delete_user', { p_user_id: userId })

  if (error) {
    // Fallback: ถ้า rpc function ยังไม่มี → ลองใช้ raw SQL ผ่าน REST
    console.error('[admin/delete] rpc failed, trying raw approach:', error.message)
    return await fallbackHardDelete(sb, userId)
  }

  return NextResponse.json({ ok: true, mode: 'hard' })
}

// Fallback: ลบทีละ table ด้วย Supabase client + check error ทุกขั้น
async function fallbackHardDelete(sb: ReturnType<typeof db>, userId: string) {
  const errors: string[] = []

  // 1. ดึง listing IDs
  const { data: userListings } = await sb.from('listings').select('id').eq('seller_id', userId)
  const listingIds = (userListings || []).map((l: any) => l.id)

  // 2. NULL out contact_events FK (ต้อง check error ไม่ใช่ try/catch)
  const nullOps = [
    sb.from('contact_events').update({ seller_id: null } as any).eq('seller_id', userId),
    sb.from('contact_events').update({ buyer_id: null } as any).eq('buyer_id', userId),
    sb.from('contact_messages').update({ user_id: null } as any).eq('user_id', userId),
    sb.from('admin_actions').update({ admin_id: null } as any).eq('admin_id', userId),
    sb.from('id_verifications').update({ reviewed_by: null } as any).eq('reviewed_by', userId),
    sb.from('reports').update({ reporter_user_id: null } as any).eq('reporter_user_id', userId),
  ]
  for (const op of nullOps) {
    const { error } = await op
    if (error) errors.push(`null out: ${error.message}`)
  }

  // 3. ลบ contact_events ที่อ้าง listings
  for (const lid of listingIds) {
    const { error } = await sb.from('contact_events').delete().eq('listing_id', lid)
    if (error) errors.push(`del contact_events.listing ${lid}: ${error.message}`)
  }

  // 4. ลบ tables ที่อ้าง user
  const tables = [
    'notifications', 'push_subscriptions', 'phone_changes_log', 'phone_otps',
    'sessions', 'wanted', 'wanted_notifications', 'search_logs',
    'id_verifications', 'reports', 'contact_events',
  ]
  for (const t of tables) {
    const { error } = await sb.from(t).delete().eq('user_id', userId)
    if (error && !error.message.includes('column') && !error.message.includes('does not exist')) {
      errors.push(`del ${t}: ${error.message}`)
    }
  }
  // reports ที่ user ถูกรายงาน
  await sb.from('reports').delete().eq('reported_user_id', userId)

  // 5. ลบ listings
  const { error: listErr } = await sb.from('listings').delete().eq('seller_id', userId)
  if (listErr) errors.push(`del listings: ${listErr.message}`)

  // 6. ลบ user
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
