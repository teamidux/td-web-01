// แจ้งเตือนคนที่ตามหา เมื่อมีคนลงขายหนังสือเล่มนั้น
// เรียกจาก sell page หลัง listing insert สำเร็จ
// ส่ง Web Push (ฟรี ไม่จำกัด) + LINE OA (ถ้า add OA แล้ว)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pushLineText } from '@/lib/line-bot'
import webpush from 'web-push'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    // ต้อง login แล้วเท่านั้น (เรียกจาก sell page หลัง listing insert)
    const { getSessionUser } = await import('@/lib/session')
    const sessionUser = await getSessionUser()
    if (!sessionUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Security: ไม่เชื่อ seller_id / price / isbn จาก client — ผู้ส่งต้องเป็นคนที่มีประกาศ active ของเล่มนี้จริง
    // และข้อความที่ส่งออก (LINE/push) ใช้ค่าจาก DB เท่านั้น (กันยัดลิงก์หลอกลวงผ่าน OA ของเรา)
    const body = await req.json().catch(() => ({})) as { book_id?: unknown }
    const book_id = typeof body.book_id === 'string' ? body.book_id : null
    const seller_id = sessionUser.id
    if (!book_id) return NextResponse.json({ ok: true, sent: 0 })

    const sb = db()

    // ดึงชื่อหนังสือ + ประกาศล่าสุดของผู้ส่งสำหรับเล่มนี้
    const [{ data: book }, { data: listing }] = await Promise.all([
      sb.from('books').select('title, isbn').eq('id', book_id).maybeSingle(),
      sb.from('listings').select('price').eq('book_id', book_id).eq('seller_id', seller_id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (!book || !listing) return NextResponse.json({ ok: true, sent: 0 })
    const price = typeof listing.price === 'number' ? listing.price : null

    const bookIsbn = book.isbn

    // หาคนที่ตามหาเล่มนี้ (ไม่รวม seller เองถ้า seller เคยตามหา)
    const { data: wanted } = await sb
      .from('wanted')
      .select('user_id')
      .eq('book_id', book_id)
      .eq('status', 'waiting')
      .neq('user_id', seller_id)
    if (!wanted?.length) return NextResponse.json({ ok: true, sent: 0 })

    const userIds = wanted.map(w => w.user_id)

    // Dedup: เช็คว่าเคยแจ้ง (user, book, seller) ไปแล้วหรือยัง
    // ถ้าเคยแล้ว → skip (seller เดิมลงเล่มเดิม ไม่ต้องแจ้งซ้ำ)
    const { data: alreadyNotified } = await sb
      .from('wanted_notifications')
      .select('user_id')
      .eq('book_id', book_id)
      .eq('seller_id', seller_id)
      .in('user_id', userIds)
    const notifiedSet = new Set((alreadyNotified || []).map(r => r.user_id))
    const freshUserIds = userIds.filter(id => !notifiedSet.has(id))
    if (!freshUserIds.length) return NextResponse.json({ ok: true, sent: 0, skipped: userIds.length })

    // ดึง users ทั้งหมดที่ตามหา (ส่ง Web Push ได้ทุกคน, LINE เฉพาะคนที่ add OA)
    const { data: users } = await sb
      .from('users')
      .select('id, display_name, line_user_id, line_oa_friend_at')
      .in('id', freshUserIds)

    // === In-app notification — ทุกคน ทุก platform ===
    const notifRows = freshUserIds.map(uid => ({
      user_id: uid,
      type: 'wanted_match',
      title: 'มีหนังสือที่คุณตามหา!',
      body: `"${book.title}" ลงขายแล้ว ฿${price || '—'}`,
      url: `/book/${bookIsbn}`,
      metadata: { book_id, seller_id, isbn: bookIsbn },
    }))
    if (notifRows.length) {
      await sb.from('notifications').insert(notifRows)
    }

    // === Web Push — ส่งทุกคนที่มี subscription (ฟรี ไม่จำกัด) ===
    const vapidSubject = process.env.VAPID_SUBJECT
    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY
    let webPushSent = 0
    if (vapidSubject && vapidPublic && vapidPrivate) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
      const { data: subs } = await sb
        .from('push_subscriptions')
        .select('user_id, subscription')
        .in('user_id', freshUserIds)
      if (subs?.length) {
        const payload = JSON.stringify({
          title: 'มีหนังสือที่คุณตามหา!',
          body: `"${book.title}" ลงขายแล้ว ฿${price || '—'}`,
          url: `/book/${bookIsbn}`,
          tag: `wanted-${bookIsbn}`,
        })
        const expired: string[] = []
        await Promise.allSettled(subs.map(async s => {
          try { await webpush.sendNotification(s.subscription, payload); webPushSent++ }
          catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) expired.push(s.user_id) }
        }))
        if (expired.length) await sb.from('push_subscriptions').delete().in('user_id', expired)
      }
    }

    // === LINE Push — เฉพาะคนที่ add OA แล้ว ===
    let sent = 0
    const logRows: { user_id: string; book_id: string; seller_id: string }[] = []
    for (const u of (users || []).filter(u => u.line_user_id && u.line_oa_friend_at)) {
      const msg = `📚 หนังสือที่คุณตามหามีคนลงขายแล้ว!\n\n"${book.title}"\nราคา ฿${price || '—'}\n\nดูรายละเอียด:\nbookmatch.app/book/${bookIsbn}`
      const result = await pushLineText(u.line_user_id, msg)
      if (result.success) sent++
    }
    // Log ทุกคนที่แจ้ง (Web Push + LINE) ไม่ให้แจ้งซ้ำ
    for (const uid of freshUserIds) {
      logRows.push({ user_id: uid, book_id, seller_id })
    }

    // Log ว่าแจ้งไปแล้ว — ครั้งหน้า seller เดิมลงเล่มเดิม จะ skip
    // Seller คนใหม่มาลง → คนละ row → แจ้งได้
    if (logRows.length) {
      await sb.from('wanted_notifications').insert(logRows)
    }

    return NextResponse.json({ ok: true, line_sent: sent, web_push_sent: webPushSent, total_wanted: wanted.length, skipped: notifiedSet.size })
  } catch (e: any) {
    console.error('[notify/wanted-match]', e?.message)
    return NextResponse.json({ ok: true, sent: 0 }) // ไม่ให้ error block UX
  }
}
