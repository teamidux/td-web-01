// Admin: ดูข้อความจากสมาชิก + reports
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = db()
  const [{ data: messages }, { data: reports }, { data: feedback }] = await Promise.all([
    sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('reports').select('*, reporter:reporter_user_id(display_name), reported:reported_user_id(display_name)').order('created_at', { ascending: false }).limit(50),
    sb.from('feedback').select('*, user:user_id(display_name)').order('created_at', { ascending: false }).limit(50),
  ])

  return NextResponse.json({
    messages: messages || [],
    reports: reports || [],
    feedback: feedback || [],
  })
}
