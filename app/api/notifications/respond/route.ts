// บันทึกคำตอบของผู้ขายบนแจ้งเตือน "มีคนสนใจ" (ยังมี / ขายแล้ว) ลง metadata ของแจ้งเตือนนั้น
// POST { id, answer: 'available' | 'sold' } — เฉพาะแจ้งเตือนของตัวเอง
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: unknown; answer?: unknown }
  const id = typeof body.id === 'string' ? body.id : ''
  const answer = body.answer === 'available' || body.answer === 'sold' ? body.answer : null
  if (!id || !answer) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: n } = await sb.from('notifications').select('id, metadata').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!n) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const metadata = { ...((n.metadata as Record<string, unknown>) || {}), availability: answer, answered_at: new Date().toISOString() }
  const { error } = await sb.from('notifications').update({ metadata, read_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
