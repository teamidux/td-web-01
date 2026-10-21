// Admin: รวมหนังสือซ้ำ (เช่น BM-xxxxx ที่ผู้ขายสร้างแบบไม่มี ISBN ซ้ำกับเล่มที่มี ISBN)
// GET /api/tomga/books/merge?from=BM-MA69Y&to=9789749898420            → preview (ไม่แก้อะไร)
// GET /api/tomga/books/merge?from=BM-MA69Y&to=9789749898420&confirm=1  → ทำจริง
//
// ทำอะไร: ย้าย listings / wanted / contact_events / book_reports / wanted_notifications
// จาก from → to, เติม cover/publisher/translator ที่ to ยังว่าง, รวม view_count, ลบ from, recount
// ลำดับสำคัญ: ลบ from เป็นขั้นสุดท้าย — ถ้าขั้นไหนล้มเหลว ไม่มีข้อมูลหาย (เรียกซ้ำได้)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BOOK_COLS = 'id, isbn, title, author, publisher, translator, cover_url, view_count, active_listings_count, wanted_count'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const from = (req.nextUrl.searchParams.get('from') || '').trim()
  const to = (req.nextUrl.searchParams.get('to') || '').trim()
  const confirm = req.nextUrl.searchParams.get('confirm') === '1'
  if (!from || !to || from === to) return NextResponse.json({ error: 'need from & to (different isbn)' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [{ data: f }, { data: t }] = await Promise.all([
    sb.from('books').select(BOOK_COLS).eq('isbn', from).maybeSingle(),
    sb.from('books').select(BOOK_COLS).eq('isbn', to).maybeSingle(),
  ])
  if (!t) return NextResponse.json({ error: `target ${to} not found` }, { status: 404 })
  if (!f) return NextResponse.json({ ok: true, skipped: true, reason: `${from} not found (already merged?)`, to: t })

  const count = async (table: string, col = 'book_id') => {
    const { count: c } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, f.id)
    return c ?? 0
  }
  const before = {
    listings: await count('listings'),
    wanted: await count('wanted'),
    contact_events: await count('contact_events'),
  }
  if (!confirm) {
    return NextResponse.json({ ok: true, preview: true, hint: 'เพิ่ม &confirm=1 เพื่อทำจริง', from: f, to: t, will_move: before })
  }

  const steps: Record<string, string> = {}
  const run = async (name: string, p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    steps[name] = error ? `ERROR: ${error.message}` : 'ok'
    if (error) throw new Error(`${name}: ${error.message}`)
  }

  try {
    await run('listings', sb.from('listings').update({ book_id: t.id }).eq('book_id', f.id))

    // wanted: ย้ายเฉพาะคนที่ยังไม่ได้ตามหาเล่มปลายทาง (กัน unique ซ้ำ) ที่เหลือลบ
    const { data: toWanted } = await sb.from('wanted').select('user_id').eq('book_id', t.id)
    const already = new Set((toWanted || []).map((w: { user_id: string }) => w.user_id))
    const { data: fromWanted } = await sb.from('wanted').select('id, user_id').eq('book_id', f.id)
    for (const w of fromWanted || []) {
      if (already.has(w.user_id)) await run(`wanted_delete_${w.id}`, sb.from('wanted').delete().eq('id', w.id))
      else await run(`wanted_move_${w.id}`, sb.from('wanted').update({ book_id: t.id }).eq('id', w.id))
    }

    await run('contact_events', sb.from('contact_events').update({ book_id: t.id }).eq('book_id', f.id))
    await run('book_reports', sb.from('book_reports').update({ book_id: t.id }).eq('book_id', f.id))
    await run('wanted_notifications', sb.from('wanted_notifications').update({ book_id: t.id }).eq('book_id', f.id))

    const fill: Record<string, unknown> = { view_count: (t.view_count || 0) + (f.view_count || 0) }
    if (!t.cover_url && f.cover_url) fill.cover_url = f.cover_url
    if (!t.publisher && f.publisher) fill.publisher = f.publisher
    if (!t.translator && f.translator) fill.translator = f.translator
    await run('fill_target', sb.from('books').update(fill).eq('id', t.id))

    await run('delete_from', sb.from('books').delete().eq('id', f.id))

    // recount (trigger ทำให้อยู่แล้ว — ยืนยันอีกชั้น)
    const { data: act } = await sb.from('listings').select('price').eq('book_id', t.id).eq('status', 'active')
    const prices = (act || []).map((l: { price: number }) => l.price)
    await run('recount', sb.from('books').update({
      active_listings_count: prices.length,
      min_price: prices.length ? Math.min(...prices) : null,
    }).eq('id', t.id))
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed', steps }, { status: 500 })
  }

  const { data: after } = await sb.from('books').select(BOOK_COLS).eq('id', t.id).maybeSingle()
  return NextResponse.json({ ok: true, merged: `${from} -> ${to}`, moved: before, steps, to: after })
}
