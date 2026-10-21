// Admin: สรุปคุณภาพ AI อ่านปก จาก log ที่เก็บตอนลงขาย
// GET /api/tomga/scan-logs?days=30          → สรุป + รายการที่ผู้ขายแก้
// GET /api/tomga/scan-logs?days=30&raw=1    → ทุก record
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'
import { listAiScanLogs } from '@/lib/ai-scan-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function pct(n: number, d: number) { return d ? Math.round((n / d) * 1000) / 10 : null }

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') || 30), 1), 365)
  const raw = req.nextUrl.searchParams.get('raw') === '1'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const logs = await listAiScanLogs(sb, days)

  const withAi = logs.filter(l => l.ai_parsed?.title)
  const by = (key: (l: typeof logs[number]) => string) => {
    const m: Record<string, { n: number; title_changed: number; author_changed: number; title_known: number; author_known: number }> = {}
    for (const l of withAi) {
      const k = key(l)
      m[k] ||= { n: 0, title_changed: 0, author_changed: 0, title_known: 0, author_known: 0 }
      m[k].n++
      if (l.diff.title_changed !== null) { m[k].title_known++; if (l.diff.title_changed) m[k].title_changed++ }
      if (l.diff.author_changed !== null) { m[k].author_known++; if (l.diff.author_changed) m[k].author_changed++ }
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, {
      n: v.n,
      title_changed_pct: pct(v.title_changed, v.title_known),
      author_changed_pct: pct(v.author_changed, v.author_known),
    }]))
  }

  const summary = {
    days,
    total_listings_logged: logs.length,
    ai_read_title: withAi.length,
    ai_failed_or_empty: logs.length - withAi.length,
    picked_existing_book: logs.filter(l => l.existing_book_id).length,
    by_flow: by(l => l.flow),
    by_confidence: by(l => l.ai_parsed?.confidence || 'unknown'),
    avg_ai_ms: withAi.length
      ? Math.round(withAi.reduce((s, l) => s + (Number((l.ai as { duration_ms?: number })?.duration_ms) || 0), 0) / withAi.length)
      : null,
  }

  const edited = withAi
    .filter(l => l.diff.title_changed || l.diff.author_changed)
    .map(l => ({
      at: l.at, flow: l.flow, isbn: l.isbn, confidence: l.ai_parsed?.confidence,
      ai_title: [l.ai_parsed?.title, l.ai_parsed?.subtitle].filter(Boolean).join(' '),
      final_title: l.final.title,
      ai_author: l.ai_parsed?.authors?.join(', ') || null,
      final_author: l.final.author,
    }))

  return NextResponse.json(raw ? { summary, logs } : { summary, edited })
}
