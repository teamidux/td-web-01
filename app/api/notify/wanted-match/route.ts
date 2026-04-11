// แจ้งเตือนคนที่ตามหา เมื่อมีคนลงขายหนังสือเล่มนั้น
// เรียกจาก sell page หลัง listing insert สำเร็จ
// ส่ง LINE OA message (ฟรี 200/เดือน) — web push ไว้เพิ่มทีหลัง

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pushLineText } from '@/lib/line-bot'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const { book_id, price, isbn } = await req.json()
    if (!book_id) return NextResponse.json({ ok: true, sent: 0 })

    const sb = db()

    // ดึงชื่อหนังสือ
    const { data: book } = await sb
      .from('books')
      .select('title, isbn')
      .eq('id', book_id)
      .maybeSingle()
    if (!book) return NextResponse.json({ ok: true, sent: 0 })

    const bookIsbn = isbn || book.isbn

    // หาคนที่ตามหาเล่มนี้
    const { data: wanted } = await sb
      .from('wanted')
      .select('user_id')
      .eq('book_id', book_id)
      .eq('status', 'waiting')
    if (!wanted?.length) return NextResponse.json({ ok: true, sent: 0 })

    const userIds = wanted.map(w => w.user_id)

    // ดึงเฉพาะคนที่ add OA แล้ว (ไม่งั้นส่งไปก็ fail + เสียเครดิต)
    // ต้องมีทั้ง line_user_id + line_oa_friend_at
    const { data: users } = await sb
      .from('users')
      .select('id, display_name, line_user_id')
      .in('id', userIds)
      .not('line_user_id', 'is', null)
      .not('line_oa_friend_at', 'is', null)

    let sent = 0
    const notifiedUserIds: string[] = []
    for (const u of users || []) {
      const msg = `📚 หนังสือที่คุณตามหามีคนลงขายแล้ว!\n\n"${book.title}"\nราคา ฿${price || '—'}\n\nดูรายละเอียด:\nbookmatch.app/book/${bookIsbn}`
      const result = await pushLineText(u.line_user_id, msg)
      if (result.success) {
        sent++
        notifiedUserIds.push(u.id)
      }
    }

    // ลบ wanted row ของคนที่แจ้งเตือนสำเร็จ — กัน spam ข้อความซ้ำ
    // ถ้า user ดูแล้วไม่ถูกใจ seller → ไปกด "🔔 ตามหาเล่มนี้" ใหม่ที่หน้า book ได้
    if (notifiedUserIds.length) {
      await sb
        .from('wanted')
        .delete()
        .eq('book_id', book_id)
        .in('user_id', notifiedUserIds)
    }

    return NextResponse.json({ ok: true, sent, total_wanted: wanted.length })
  } catch (e: any) {
    console.error('[notify/wanted-match]', e?.message)
    return NextResponse.json({ ok: true, sent: 0 }) // ไม่ให้ error block UX
  }
}
