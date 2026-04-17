// Admin — book metadata reports
// GET: list pending reports + reporter info
// POST: approve / reject + notify reporter
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

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = new URL(req.url).searchParams.get('status') || 'pending'
  const sb = db()

  const { data: items } = await sb
    .from('book_reports')
    .select('*, reporter:reporter_id(id, display_name, avatar_url), book:book_id(id, isbn, title, author, cover_url)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100)

  return NextResponse.json({ items: items || [] })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { reportId, action, adminNotes } = await req.json()
  if (!reportId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const sb = db()

  // ดึง report มาก่อนเพื่อใช้ข้อมูลตอน approve + ตอนแจ้งกลับ reporter
  const { data: report, error: fetchErr } = await sb
    .from('book_reports')
    .select('*, book:book_id(id, title)')
    .eq('id', reportId)
    .eq('status', 'pending')
    .maybeSingle()
  if (fetchErr || !report) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ถ้า approve → update books.title
  if (action === 'approve' && report.book_id && report.field === 'title') {
    const { error: updErr } = await sb
      .from('books')
      .update({ title: report.suggested_value })
      .eq('id', report.book_id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // Mark report resolved
  await sb.from('book_reports')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      admin_notes: adminNotes || null,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  // แจ้งกลับ reporter
  if (report.reporter_id) {
    const bookTitle = (report as any).book?.title || report.current_value || 'หนังสือ'
    const approved = action === 'approve'
    await sb.from('notifications').insert({
      user_id: report.reporter_id,
      type: 'report_resolved',
      title: approved ? '✅ รายงานได้รับการอนุมัติ' : '❌ รายงานถูกปฏิเสธ',
      body: approved
        ? `ชื่อ "${report.current_value}" → "${report.suggested_value}" ถูกอัปเดตแล้ว ขอบคุณที่ช่วยเรา 🙏`
        : `รายงานแก้ชื่อ "${bookTitle}" ไม่ผ่านการตรวจสอบ${adminNotes ? ` — ${adminNotes}` : ''}`,
      url: report.book_id ? `/book/${report.isbn || ''}` : null,
      metadata: { report_id: reportId, book_id: report.book_id },
    })
  }

  return NextResponse.json({ ok: true })
}
