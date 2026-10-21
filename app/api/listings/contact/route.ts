// Log contact event + แจ้งผู้ขายผ่าน Web Push
// เก็บทุกครั้งที่ผู้ซื้อกด "ติดต่อ" ผู้ขาย
// ไม่ต้อง auth — guest ก็กดได้ (เก็บ buyer_id ถ้า login)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import webpush from 'web-push'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    // กัน spam แจ้งเตือน/ปั่นสถิติ: จำกัดต่อ IP (คนซื้อจริงกดไม่ถึง) — ตอบ ok เงียบๆ ไม่ให้ block UX
    if (!checkRateLimit(`contact-event:${getClientIp(req)}`, 30, 60_000)) return NextResponse.json({ ok: true })

    const { listing_id } = await req.json()
    if (!listing_id || typeof listing_id !== 'string') return NextResponse.json({ error: 'missing listing_id' }, { status: 400 })

    const user = await getSessionUser().catch(() => null)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Security: seller_id / book_id เอาจากประกาศจริงใน DB ไม่รับจาก client (กันยิงแจ้งเตือนหา user ใดก็ได้)
    const { data: lst } = await supabase.from('listings').select('seller_id, book_id, price').eq('id', listing_id).maybeSingle()
    if (!lst) return NextResponse.json({ ok: true })
    const seller_id = lst.seller_id as string
    const book_id = lst.book_id as string | null

    // ไม่บันทึก + ไม่แจ้ง ถ้าตัวเองกดดูของตัวเอง
    const isSelf = user?.id && user.id === seller_id

    if (!isSelf) {
      await supabase.from('contact_events').insert({
        listing_id,
        book_id: book_id || null,
        seller_id: seller_id || null,
        buyer_id: user?.id || null,
      })

      // Web Push แจ้งผู้ขาย — fire-and-forget ไม่ block response
      if (seller_id) {
        notifySeller(supabase, seller_id, book_id, listing_id, typeof lst.price === 'number' ? lst.price : null).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // ไม่ให้ tracking error block UX
  }
}

async function notifySeller(supabase: any, sellerId: string, bookId: string | null, listingId: string | null = null, price: number | null = null) {
  // === ดึงข้อมูลหนังสือ + นับจำนวนคนที่เคยกดติดต่อ ===
  let bookTitle = 'หนังสือของคุณ'
  let bookIsbn = ''
  let contactCount = 1

  if (bookId) {
    const [bookRes, countRes] = await Promise.all([
      supabase.from('books').select('title, isbn').eq('id', bookId).maybeSingle(),
      supabase.from('contact_events').select('id', { count: 'exact', head: true }).eq('book_id', bookId).eq('seller_id', sellerId),
    ])
    if (bookRes.data?.title) bookTitle = `"${bookRes.data.title}"`
    if (bookRes.data?.isbn) bookIsbn = bookRes.data.isbn
    if (countRes.count) contactCount = countRes.count
  }

  // === Copy ที่ actionable ===
  const title = contactCount === 1
    ? `มีคนสนใจ ${bookTitle}!`
    : `${bookTitle} มีคนสนใจแล้ว ${contactCount} คน!`
  const priceText = price ? ` (ราคา ฿${price})` : ''
  const body = contactCount === 1
    ? `มีคนกดดูช่องทางติดต่อคุณ${priceText} รอข้อความจากผู้ซื้อได้เลย — เล่มนี้ยังมีอยู่ไหม? ตอบได้ที่หน้าแจ้งเตือน`
    : `มี ${contactCount} คนกดดูช่องทางติดต่อคุณแล้ว${priceText} — เล่มนี้ยังมีอยู่ไหม? ตอบได้ที่หน้าแจ้งเตือน`
  const url = bookIsbn ? `/book/${bookIsbn}` : '/profile'

  // === In-app notification ===
  if (bookId) {
    await supabase.from('notifications').insert({
      user_id: sellerId,
      type: 'contact',
      title,
      body,
      url,
      metadata: { book_id: bookId, listing_id: listingId, contact_count: contactCount },
    })
  }

  // === Web Push (bonus) ===
  const vapidSubject = process.env.VAPID_SUBJECT
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidSubject || !vapidPublic || !vapidPrivate) return

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', sellerId)
    .maybeSingle()
  if (!sub?.subscription) return

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const payload = JSON.stringify({
    title,
    body,
    url,
    tag: `contact-${bookId || sellerId}`,
  })

  try {
    await webpush.sendNotification(sub.subscription, payload)
  } catch (e: any) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', sellerId)
    }
  }
}
