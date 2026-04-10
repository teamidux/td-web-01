// Admin: list pending verifications + approve/reject + LINE notify
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'
import { pushLineText } from '@/lib/line-bot'

export const runtime = 'nodejs'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET — list users with id_verify_submitted_at but no id_verified_at
export async function GET() {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = sb()
  const { data, error } = await db
    .from('users')
    .select('id, display_name, phone, line_id, line_user_id, id_verify_submitted_at, id_verified_at, created_at')
    .not('id_verify_submitted_at', 'is', null)
    .is('id_verified_at', null)
    .order('id_verify_submitted_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pending = []
  for (const u of data || []) {
    const { data: files } = await db.storage
      .from('identity-docs')
      .list(u.id, { limit: 10, sortBy: { column: 'created_at', order: 'desc' } })

    const docs: { name: string; url: string }[] = []
    for (const f of files || []) {
      const { data: signed } = await db.storage
        .from('identity-docs')
        .createSignedUrl(`${u.id}/${f.name}`, 3600)
      if (signed?.signedUrl) {
        docs.push({ name: f.name, url: signed.signedUrl })
      }
    }
    pending.push({ ...u, docs })
  }

  return NextResponse.json({ pending })
}

// POST — approve or reject (with reasons + LINE notify)
export async function POST(req: NextRequest) {
  const currentUser = await getSessionUser()
  if (!currentUser || !isAdmin(currentUser.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { userId, action, reasons } = await req.json()
  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'invalid params' }, { status: 400 })
  }

  const db = sb()

  // Get user for LINE notification
  const { data: targetUser } = await db
    .from('users')
    .select('display_name, line_user_id')
    .eq('id', userId)
    .maybeSingle()

  if (action === 'approve') {
    const { error } = await db.from('users').update({ id_verified_at: new Date().toISOString() }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // LINE notify: approved
    if (targetUser?.line_user_id) {
      await pushLineText(
        targetUser.line_user_id,
        `✅ ยืนยันตัวตนสำเร็จ\n\nสวัสดีคุณ ${targetUser.display_name}\nเอกสารของคุณผ่านการตรวจสอบแล้ว\n\nคุณได้รับป้าย 🛡️ ลงทะเบียนแล้ว\nลูกค้าจะมั่นใจและติดต่อคุณมากขึ้น\n\n📚 bookmatch.app/profile`
      )
    }
  } else {
    // reject — clear submitted_at so user can re-submit
    const { error } = await db.from('users').update({ id_verify_submitted_at: null }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // LINE notify: rejected with reasons
    if (targetUser?.line_user_id && Array.isArray(reasons) && reasons.length > 0) {
      const reasonList = reasons.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')
      await pushLineText(
        targetUser.line_user_id,
        `❌ ยืนยันตัวตนไม่ผ่าน\n\nสวัสดีคุณ ${targetUser.display_name}\nเอกสารของคุณยังไม่ผ่านการตรวจสอบ\n\nเหตุผล:\n${reasonList}\n\n📸 กรุณาถ่ายรูปใหม่แล้วส่งอีกครั้งที่\n📚 bookmatch.app/profile`
      )
    }
  }

  return NextResponse.json({ ok: true, action })
}
