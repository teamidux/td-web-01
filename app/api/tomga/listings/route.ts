// Admin: listings management — list, search, remove
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/admin'
import { logAdminAction } from '@/lib/audit'
import { pushLineText } from '@/lib/line-bot'

export const runtime = 'nodejs'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function currentAdmin() {
  const token = cookies().get('bm_session')?.value
  if (!token) return null
  const db = sb()
  const { data } = await db.from('sessions').select('users(id)').eq('token', token).maybeSingle()
  const id = (data as any)?.users?.id
  return id && isAdmin(id) ? id : null
}

// คำต้องห้ามในเนื้อหา (เริ่มแบบ hardcode — ปรับได้ทีหลัง)
const FORBIDDEN_WORDS = ['โป๊', '18+', 'erotic', 'นู้ด', 'หนังxxx', 'xxx', 'sex toy']

function detectForbidden(text: string): string[] {
  const lower = text.toLowerCase()
  return FORBIDDEN_WORDS.filter(w => lower.includes(w.toLowerCase()))
}

export async function GET(req: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const tab = url.searchParams.get('tab') || 'active' // active | removed | flagged
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
  const limit = Math.max(1, Math.min(150, parseInt(url.searchParams.get('limit') || '100', 10) || 100))

  const db = sb()
  let query = db
    .from('listings')
    .select('id, book_id, seller_id, condition, price, contact, notes, photos, status, created_at, books(title, author, isbn, cover_url), users(display_name, line_id, phone)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (tab === 'removed') {
    query = query.eq('status', 'removed')
  } else if (tab === 'active' || tab === 'flagged') {
    query = query.eq('status', 'active')
  }

  const { data, error } = await query
  if (error) {
    console.error('[tomga/listings] db error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  let listings = (data || []) as any[]

  // Tag flagged เนื้อหา
  for (const l of listings) {
    const text = `${l.books?.title || ''} ${l.notes || ''}`
    l.flagged_words = detectForbidden(text)
  }

  if (tab === 'flagged') {
    listings = listings.filter(l => l.flagged_words.length > 0)
  }

  // Search filter (in-memory เพราะข้าม table)
  if (q) {
    const ql = q.toLowerCase()
    listings = listings.filter(l =>
      l.books?.title?.toLowerCase().includes(ql) ||
      l.books?.isbn?.toLowerCase().includes(ql) ||
      l.users?.display_name?.toLowerCase().includes(ql)
    )
  }

  return NextResponse.json({ listings })
}

export async function POST(req: NextRequest) {
  const adminId = await currentAdmin()
  if (!adminId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { listingId, action, reason } = await req.json()
  if (!listingId || action !== 'remove') {
    return NextResponse.json({ error: 'invalid params' }, { status: 400 })
  }
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: 'reason required' }, { status: 400 })
  }

  const db = sb()

  // Get listing + seller info สำหรับ LINE notify
  const { data: listing } = await db
    .from('listings')
    .select('seller_id, books(title), users(line_user_id, display_name, line_oa_friend_at)')
    .eq('id', listingId)
    .maybeSingle()

  const { error } = await db.from('listings').update({ status: 'removed' }).eq('id', listingId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // LINE notify seller
  const seller = (listing as any)?.users
  if (seller?.line_user_id && seller?.line_oa_friend_at) {
    const bookTitle = (listing as any)?.books?.title || 'หนังสือ'
    pushLineText(
      seller.line_user_id,
      `⚠️ Listing ของคุณถูกลบจากระบบ\n\n"${bookTitle}"\n\nเหตุผล: ${reason}\n\nหากมีข้อสงสัยกรุณาติดต่อ admin\n📚 bookmatch.app`
    ).catch(() => {})
  }

  logAdminAction({
    adminId,
    action: 'remove_listing',
    targetType: 'listing',
    targetId: listingId,
    reason,
  })

  return NextResponse.json({ ok: true })
}
