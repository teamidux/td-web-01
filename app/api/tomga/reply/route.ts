// Admin: ตอบกลับเรื่องที่สมาชิกแจ้ง + แจ้งเตือนคนแจ้งกลับ
//   kind='feedback' (default): ตาราง feedback → บันทึกลง admin_note + status='resolved'
//   kind='message':            ตาราง contact_messages → set read_at (ไม่มี column เก็บคำตอบ
//                              จึงเก็บคำตอบไว้ใน notifications.metadata.contact_message_id แทน)
//   ทั้งสองแบบ: สร้าง in-app notification ให้คนแจ้ง (ถ้า login ตอนส่ง → มี user_id)
//               + ส่ง LINE push ถ้าคนแจ้ง add OA ไว้ (มี line_user_id)
// ถ้าเป็น anonymous (ไม่มี user_id) → ตอบอัตโนมัติไม่ได้ คืน contact ให้ admin ติดต่อเอง
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'
import { pushLineText } from '@/lib/line-bot'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Target = {
  userId: string | null
  lineUserId: string | null
  contact: string | null
  originalMessage: string
}

export async function POST(req: NextRequest) {
  const admin = await getSessionUser()
  if (!admin || !isAdmin(admin.id)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const id = typeof body.id === 'string' ? body.id : ''
  const reply = typeof body.reply === 'string' ? body.reply.trim() : ''
  const kind = body.kind === 'message' ? 'message' : 'feedback'
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (!reply) return NextResponse.json({ error: 'missing_reply', message: 'กรุณาพิมพ์ข้อความตอบกลับ' }, { status: 400 })
  if (reply.length > 2000) return NextResponse.json({ error: 'reply_too_long', message: 'ข้อความยาวเกิน 2000 ตัวอักษร' }, { status: 400 })

  const sb = db()
  const now = new Date().toISOString()
  let target: Target

  if (kind === 'feedback') {
    const { data: fb, error: fbErr } = await sb
      .from('feedback')
      .select('id, message, user_id, contact, user:user_id(line_user_id)')
      .eq('id', id)
      .maybeSingle()
    if (fbErr) {
      console.error('[tomga/reply] feedback select error:', fbErr.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!fb) return NextResponse.json({ error: 'not_found', message: 'ไม่พบเรื่องที่แจ้งนี้' }, { status: 404 })

    // บันทึกคำตอบ + ปิดเรื่อง (ใช้ column เดิม ไม่ต้อง migrate)
    const { error: updErr } = await sb
      .from('feedback')
      .update({ admin_note: reply, status: 'resolved', reviewed_at: now })
      .eq('id', id)
    if (updErr) {
      console.error('[tomga/reply] feedback update error:', updErr.message)
      return NextResponse.json({ error: 'db_error', message: 'บันทึกคำตอบไม่สำเร็จ' }, { status: 500 })
    }
    const row = fb as any
    target = {
      userId: row.user_id || null,
      lineUserId: row.user?.line_user_id || null,
      contact: row.contact || null,
      originalMessage: row.message || '',
    }
  } else {
    const { data: msg, error: msgErr } = await sb
      .from('contact_messages')
      .select('id, message, user_id, email, user:user_id(line_user_id)')
      .eq('id', id)
      .maybeSingle()
    if (msgErr) {
      console.error('[tomga/reply] message select error:', msgErr.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!msg) return NextResponse.json({ error: 'not_found', message: 'ไม่พบข้อความนี้' }, { status: 404 })

    const { error: updErr } = await sb
      .from('contact_messages')
      .update({ read_at: now })
      .eq('id', id)
    if (updErr) console.error('[tomga/reply] message mark-read error:', updErr.message)

    const row = msg as any
    target = {
      userId: row.user_id || null,
      lineUserId: row.user?.line_user_id || null,
      contact: row.email || null,
      originalMessage: row.message || '',
    }
  }

  let notified: 'line' | 'inapp' | 'none' = 'none'

  // 1) In-app notification — ถ้าคนแจ้ง login ตอนส่ง
  if (target.userId) {
    const metadata = kind === 'feedback' ? { feedback_id: id } : { contact_message_id: id }
    const { error: notifErr } = await sb.from('notifications').insert({
      user_id: target.userId,
      type: 'system',
      title: 'ทีมงานตอบกลับเรื่องที่คุณแจ้ง',
      body: reply,
      url: '/notifications',
      metadata,
    })
    if (!notifErr) notified = 'inapp'
    else console.error('[tomga/reply] notif insert error:', notifErr.message)

    // 2) LINE push — ถ้า add OA ไว้ (ทับ in-app ถ้าส่งได้)
    if (target.lineUserId) {
      const origMsg = target.originalMessage.slice(0, 120)
      const text = `💬 ทีมงาน BookMatch ตอบกลับเรื่องที่คุณแจ้งไว้\n\n` +
        (origMsg ? `เรื่องที่แจ้ง: "${origMsg}"\n\n` : '') +
        `คำตอบ:\n${reply}`
      const res = await pushLineText(target.lineUserId, text).catch(() => ({ success: false }))
      if ((res as any)?.success) notified = 'line'
    }
  }

  return NextResponse.json({
    ok: true,
    notified,                       // 'line' | 'inapp' | 'none'
    contact: notified === 'none' ? target.contact : null,
    replied_at: now,
  })
}
