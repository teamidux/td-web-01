// Admin: ดูข้อความจากสมาชิก + reports + feedback
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

  // คำตอบที่ admin เคยส่งให้ข้อความติดต่อ — เก็บอยู่ใน notifications (metadata.contact_message_id)
  // เพราะ contact_messages ไม่มี column เก็บคำตอบ
  const msgIds = (messages || []).map((m: any) => m.id)
  let replies: Record<string, { body: string; created_at: string }> = {}
  if (msgIds.length) {
    const { data: notifs } = await sb
      .from('notifications')
      .select('body, created_at, metadata')
      .eq('type', 'system')
      .in('metadata->>contact_message_id', msgIds)
      .order('created_at', { ascending: false })
    for (const n of notifs || []) {
      const mid = (n as any).metadata?.contact_message_id
      if (mid && !replies[mid]) replies[mid] = { body: (n as any).body || '', created_at: (n as any).created_at }
    }
  }

  return NextResponse.json({
    messages: (messages || []).map((m: any) => ({ ...m, reply: replies[m.id] || null })),
    reports: reports || [],
    feedback: feedback || [],
  })
}
