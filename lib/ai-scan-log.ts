// Log คุณภาพ AI อ่านปก: สิ่งที่ AI อ่านได้ vs สิ่งที่ผู้ขายกดลงขายจริง
// ทำไม: ไม่มีตัวเลขว่า AI อ่านผิดบ่อยแค่ไหน → ตัดสินเรื่องเปลี่ยน prompt/โมเดลไม่ได้
// เก็บที่ไหน: Supabase Storage bucket ส่วนตัว (ai-scan-logs) ไฟล์ JSON ต่อ 1 ประกาศ
//   - ไม่ต้องแก้ schema DB (ไม่มีช่องทางรัน DDL จากเครื่องนี้) และ service role เท่านั้นที่อ่านได้
//   - ปริมาณไม่กี่สิบไฟล์/สัปดาห์ → อ่านรวมผ่าน /api/tomga/scan-logs ได้สบาย
// กติกา: logAiScan ห้าม throw เด็ดขาด — ถ้า log ไม่ได้ ประกาศต้องลงสำเร็จเหมือนเดิม
import type { SupabaseClient } from '@supabase/supabase-js'

export const AI_SCAN_LOG_BUCKET = 'ai-scan-logs'
const MAX_AI_JSON = 20_000 // กัน payload ใหญ่ผิดปกติจาก client

export type AiScanLogInput = {
  flow: 'cover' | 'barcode'
  user_id: string
  book_id: string | null
  listing_id: string | null
  isbn: string | null
  existing_book_id: string | null          // ผู้ขายเลือกเล่มที่มีอยู่แล้ว (แทนที่จะสร้างใหม่)
  ai: unknown                              // { model, duration_ms, parsed, parseError } จาก client
  ai_status?: string | null                // barcode flow: idle|running|success|failed
  dedup?: unknown                          // cover flow: { topMatch, searched_by, top_score, candidates }
  final: { title: string; author: string; publisher?: string; translator?: string; language?: string }
}

export type AiScanLogRecord = AiScanLogInput & {
  v: 1
  at: string
  ai_parsed: { title?: string | null; subtitle?: string | null; authors?: string[] | null; publisher?: string | null; confidence?: string | null } | null
  diff: { title_changed: boolean | null; author_changed: boolean | null; publisher_changed: boolean | null }
}

/** เทียบแบบหยาบ: ตัดช่องว่าง/วรรคตอน/ตัวพิมพ์ — "ต่าง" = ผู้ขายแก้เนื้อหาจริง ไม่ใช่แค่เว้นวรรค */
export function normLoose(s: unknown): string {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s!-\/:-@\[-`{-~‐-‧· ]+/g, '')
}

function pickParsed(ai: unknown): AiScanLogRecord['ai_parsed'] {
  const p = (ai as { parsed?: unknown } | null)?.parsed
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  return {
    title: typeof o.title === 'string' ? o.title : null,
    subtitle: typeof o.subtitle === 'string' ? o.subtitle : null,
    authors: Array.isArray(o.authors) ? o.authors.filter((a): a is string => typeof a === 'string') : null,
    publisher: typeof o.publisher === 'string' ? o.publisher : null,
    confidence: typeof o.confidence === 'string' ? o.confidence : null,
  }
}

export function buildRecord(input: AiScanLogInput): AiScanLogRecord {
  const ai_parsed = pickParsed(input.ai)
  const aiTitleFull = ai_parsed?.title
    ? normLoose(ai_parsed.title) + (ai_parsed.subtitle ? normLoose(ai_parsed.subtitle) : '')
    : ''
  const finalTitle = normLoose(input.final.title)
  // title ถือว่า "ไม่เปลี่ยน" ถ้าเท่ากับ title หรือ title+subtitle ของ AI
  const title_changed = ai_parsed?.title
    ? !(finalTitle === normLoose(ai_parsed.title) || finalTitle === aiTitleFull)
    : null
  const author_changed = ai_parsed?.authors?.length
    ? normLoose(input.final.author) !== normLoose(ai_parsed.authors.join(', '))
    : null
  const publisher_changed = ai_parsed?.publisher && input.final.publisher !== undefined
    ? normLoose(input.final.publisher) !== normLoose(ai_parsed.publisher)
    : null
  return { v: 1, at: new Date().toISOString(), ...input, ai_parsed, diff: { title_changed, author_changed, publisher_changed } }
}

async function ensureBucket(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.storage.createBucket(AI_SCAN_LOG_BUCKET, { public: false, fileSizeLimit: 1024 * 1024 })
  // "already exists" = ok
  if (error && !/exist/i.test(error.message)) throw error
}

export async function logAiScan(sb: SupabaseClient, input: AiScanLogInput): Promise<void> {
  try {
    const aiJson = JSON.stringify(input.ai ?? null)
    if (aiJson.length > MAX_AI_JSON) input = { ...input, ai: { truncated: true } }
    const rec = buildRecord(input)
    const body = JSON.stringify(rec)
    const month = rec.at.slice(0, 7)
    const safeTs = rec.at.replace(/[:.]/g, '-')
    const path = `${month}/${safeTs}_${rec.listing_id || rec.book_id || 'x'}.json`
    const upload = () => sb.storage.from(AI_SCAN_LOG_BUCKET).upload(path, body, { contentType: 'application/json', upsert: false })
    let { error } = await upload()
    if (error && /bucket/i.test(error.message)) {
      await ensureBucket(sb)
      ;({ error } = await upload())
    }
    if (error) console.warn('[ai-scan-log] upload failed:', error.message)
  } catch (e) {
    console.warn('[ai-scan-log] failed:', e instanceof Error ? e.message : e)
  }
}

/** อ่าน log ย้อนหลัง N วัน (ใช้ใน admin route) */
export async function listAiScanLogs(sb: SupabaseClient, days: number): Promise<AiScanLogRecord[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const months = new Set<string>()
  for (let d = new Date(since); d <= new Date(); d.setMonth(d.getMonth() + 1)) months.add(d.toISOString().slice(0, 7))
  months.add(new Date().toISOString().slice(0, 7))
  const paths: string[] = []
  for (const m of Array.from(months)) {
    const { data, error } = await sb.storage.from(AI_SCAN_LOG_BUCKET).list(m, { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
    if (error) { if (!/not found|bucket/i.test(error.message)) console.warn('[ai-scan-log] list:', error.message); continue }
    for (const f of data || []) {
      if (!f.name.endsWith('.json')) continue
      const ts = f.name.slice(0, 19).replace(/-/g, (c, i) => (i === 10 ? 'T' : i > 10 ? ':' : c))
      if (new Date(ts) >= since) paths.push(`${m}/${f.name}`)
    }
  }
  const out: AiScanLogRecord[] = []
  const CONC = 8
  const queue = [...paths]
  await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift()!
      const { data } = await sb.storage.from(AI_SCAN_LOG_BUCKET).download(p)
      if (!data) continue
      try { out.push(JSON.parse(await data.text())) } catch { /* ข้ามไฟล์เสีย */ }
    }
  }))
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}
