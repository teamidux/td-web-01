import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Supabase Database Webhook ส่ง record ใหม่มาใน body.record
  const body = await req.json()
  const listing = body.record ?? body
  const { book_id, price } = listing

  if (!book_id) return NextResponse.json({ error: 'missing book_id' }, { status: 400 })

  // ดึงข้อมูลหนังสือ
  const { data: book } = await supabase
    .from('books')
    .select('title, isbn')
    .eq('id', book_id)
    .single()

  if (!book) return NextResponse.json({ ok: true, sent: 0 })

  // หา user ที่รอหนังสือเล่มนี้อยู่
  const { data: wanted } = await supabase
    .from('wanted')
    .select('user_id')
    .eq('book_id', book_id)
    .eq('status', 'waiting')

  if (!wanted?.length) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = wanted.map(w => w.user_id)

  // ดึง push subscription ของแต่ละ user
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds)

  if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

  const payload = JSON.stringify({
    title: 'BookMatch — มีหนังสือที่คุณต้องการ!',
    body: `"${book.title}" ลงขายในราคา ฿${price}`,
    url: `/book/${book.isbn}`,
    tag: `book-${book.isbn}`,
  })

  // ส่ง push notification และลบ subscription ที่หมดอายุออก
  const expiredUserIds: string[] = []
  await Promise.allSettled(
    subs.map(async s => {
      try {
        await webpush.sendNotification(s.subscription, payload)
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          expiredUserIds.push(s.user_id)
        }
      }
    })
  )

  if (expiredUserIds.length) {
    await supabase.from('push_subscriptions').delete().in('user_id', expiredUserIds)
  }

  const sent = subs.length - expiredUserIds.length
  return NextResponse.json({ ok: true, sent })
}
