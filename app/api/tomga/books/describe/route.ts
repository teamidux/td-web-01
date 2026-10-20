// Admin: backfill คำอธิบายหนังสือ (AI) ให้เล่มที่ยังไม่มี — เรียกซ้ำได้จนกว่า remaining = 0
// GET /api/tomga/books/describe?limit=20   (เปิดใน browser ขณะ login เป็น admin ก็ได้)
// เลือกเล่มที่มีคนขาย/คนตามหา ก่อน (คือเล่มที่อยู่ใน sitemap และมีคนเข้าดู)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'
import { generateBookDescription, isDescriptionEnabled } from '@/lib/book-description'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isDescriptionEnabled()) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 20), 1), 40)
  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'active'
  const sb = db()

  let q = sb
    .from('books')
    .select('id, isbn, title, author, translator, publisher, category, publish_year, language')
    .or('description.is.null,description.eq.')
    .order('active_listings_count', { ascending: false })
    .order('wanted_count', { ascending: false })
    .order('view_count', { ascending: false })
    .limit(limit)
  if (scope === 'active') q = q.or('active_listings_count.gt.0,wanted_count.gt.0')
  const { data: books, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: { isbn: string; ok: boolean; len: number; error?: string }[] = []
  const CONCURRENCY = 4
  const queue = [...(books || [])]
  const worker = async () => {
    while (queue.length) {
      const b = queue.shift()!
      try {
        const { data: ls } = await sb.from('listings').select('notes').eq('book_id', b.id).eq('status', 'active').limit(3)
        const desc = await generateBookDescription({
          title: b.title, author: b.author, translator: b.translator, publisher: b.publisher,
          category: b.category, publish_year: b.publish_year, language: b.language,
          notes: (ls || []).map((l: { notes: string | null }) => l.notes || ''),
        })
        const { error: upErr } = await sb.from('books').update({ description: desc }).eq('id', b.id)
        if (upErr) throw new Error(upErr.message)
        results.push({ isbn: b.isbn, ok: true, len: desc.length })
      } catch (e) {
        results.push({ isbn: b.isbn, ok: false, len: 0, error: e instanceof Error ? e.message : 'failed' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  let remainingQ = sb.from('books').select('id', { count: 'exact', head: true }).or('description.is.null,description.eq.')
  if (scope === 'active') remainingQ = remainingQ.or('active_listings_count.gt.0,wanted_count.gt.0')
  const { count: remaining } = await remainingQ

  return NextResponse.json({
    ok: true,
    scope,
    processed: results.length,
    written: results.filter(r => r.ok && r.len > 0).length,
    empty: results.filter(r => r.ok && r.len === 0).length,
    failed: results.filter(r => !r.ok).length,
    remaining: remaining ?? null,
    results,
  })
}
