import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const listing = body.record ?? body
  const { book_id, price } = listing

  if (!book_id) return NextResponse.json({ error: 'missing book_id' }, { status: 400 })

  const { data: book } = await supabase
    .from('books')
    .select('title, isbn')
    .eq('id', book_id)
    .single()

  if (!book) return NextResponse.json({ ok: true, sent: 0 })

  const { data: wanted } = await supabase
    .from('wanted')
    .select('user_id')
    .eq('book_id', book_id)
    .eq('status', 'waiting')

  if (!wanted?.length) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = wanted.map(w => w.user_id)

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

  return NextResponse.json({ ok: true, sent: subs.length - expiredUserIds.length })
}
