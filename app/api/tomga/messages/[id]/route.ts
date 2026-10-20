// Admin: mark ข้อความติดต่อ (contact_messages) ว่าอ่านแล้ว / ยังไม่อ่าน
// PATCH { read: boolean }  — set/clear read_at
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = params.id
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const read = body?.read !== false // default = mark read

  const sb = db()
  const read_at = read ? new Date().toISOString() : null
  const { error } = await sb.from('contact_messages').update({ read_at }).eq('id', id)
  if (error) {
    console.error('[admin message mark-read]', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, read_at })
}
