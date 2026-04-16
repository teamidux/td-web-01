// Admin API: ลบ user
// POST /api/admin/user/delete { userId, mode: 'hard' | 'soft' }
//
// hard: ลบทุกอย่างหมด (สำหรับ test data)
// soft: ซ่อนข้อมูลส่วนตัว แต่เก็บ listings/events เป็นหลักฐาน (production)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function deleteFrom(sb: ReturnType<typeof db>, table: string, column: string, value: string): Promise<number> {
  try {
    const { count } = await sb.from(table).delete({ count: 'exact' }).eq(column, value)
    return count || 0
  } catch {
    return 0 // table อาจไม่มี
  }
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
  const deleted: Record<string, number> = {}

  if (mode === 'soft') {
    // === Soft Delete: ซ่อนข้อมูลส่วนตัว แต่เก็บหลักฐาน ===
    const { error } = await sb.from('users').update({
      display_name: 'ผู้ใช้ที่ลบบัญชี',
      avatar_url: null,
      line_id: null,
      phone: null,
      store_name: null,
      deleted_at: new Date().toISOString(),
      deleted_reason: 'admin_soft_delete',
    }).eq('id', userId)

    if (error) return NextResponse.json({ error: 'soft_delete_failed', message: error.message }, { status: 500 })

    // ปิด listings แต่ไม่ลบ
    await sb.from('listings').update({ status: 'removed' }).eq('seller_id', userId).eq('status', 'active')
    // ลบ sessions เตะออก
    await deleteFrom(sb, 'sessions', 'user_id', userId)

    return NextResponse.json({ ok: true, mode: 'soft', message: 'ข้อมูลส่วนตัวถูกลบ หลักฐานยังอยู่' })
  }

  // === Hard Delete: ลบทุกอย่าง (test data) ===
  // Strategy: NULL out FK references ก่อน → ลบ child rows → ลบ parent

  // 1. ดึง listing IDs ของ user นี้
  const { data: userListings } = await sb.from('listings').select('id').eq('seller_id', userId)
  const listingIds = (userListings || []).map((l: any) => l.id)

  // 2. contact_events — null out FK ก่อน แล้วลบ
  // (FK อาจไม่มี ON DELETE CASCADE → ต้อง null out เอง)
  try { await sb.from('contact_events').update({ seller_id: null }).eq('seller_id', userId) } catch {}
  try { await sb.from('contact_events').update({ buyer_id: null }).eq('buyer_id', userId) } catch {}
  // ลบ contact_events ที่อ้าง listings ของ user นี้
  for (const lid of listingIds) {
    deleted['contact_events'] = (deleted['contact_events'] || 0) + await deleteFrom(sb, 'contact_events', 'listing_id', lid)
  }

  // 3. contact_messages — null out FK
  try { await sb.from('contact_messages').update({ user_id: null }).eq('user_id', userId) } catch {}

  // 4. admin_actions — null out FK
  try { await sb.from('admin_actions').update({ admin_id: null }).eq('admin_id', userId) } catch {}

  // 5. id_verifications — null out reviewed_by FK
  try { await sb.from('id_verifications').update({ reviewed_by: null }).eq('reviewed_by', userId) } catch {}

  // 6. reports — null out reporter FK
  try { await sb.from('reports').update({ reporter_user_id: null }).eq('reporter_user_id', userId) } catch {}

  // 7. ลบ tables ที่มี ON DELETE CASCADE (ลบตรงได้)
  const cascadeTables = [
    'notifications', 'push_subscriptions', 'phone_changes_log', 'phone_otps',
    'sessions', 'wanted', 'wanted_notifications', 'search_logs',
    'id_verifications', 'reports',
  ]
  for (const table of cascadeTables) {
    deleted[table] = await deleteFrom(sb, table, 'user_id', userId)
  }
  deleted['reports.reported'] = await deleteFrom(sb, 'reports', 'reported_user_id', userId)

  // 8. ลบ listings (contact_events ที่อ้าง listing ลบไปแล้ว)
  deleted['listings'] = await deleteFrom(sb, 'listings', 'seller_id', userId)

  // 9. ลบ user สุดท้าย
  const { error } = await sb.from('users').delete().eq('id', userId)
  if (error) {
    return NextResponse.json({
      error: 'delete_user_failed',
      message: error.message,
      deleted_related: deleted,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode: 'hard', deleted_related: deleted })
}
