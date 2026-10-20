// สรุป "เกี่ยวกับหนังสือ" ด้วย Gemini จากข้อมูลที่มีจริงใน DB เท่านั้น
// ทำไมต้องมี: หน้าหนังสือไม่มีเนื้อหานอกจากชื่อ/ผู้แต่ง → Google มองเป็น thin page
// (Search Console: "Crawled - currently not indexed") และ Google Books ไม่มีข้อมูลหนังสือไทยส่วนใหญ่
//
// กติกา: ห้ามแต่งเนื้อเรื่อง/ตัวละคร/รางวัล/ตัวเลข — เขียนได้แค่สิ่งที่อนุมานจากข้อมูลที่ให้
// ผลลัพธ์แสดงบนหน้าพร้อมป้าย "สรุปโดยระบบ" และใช้ใน JSON-LD Book.description
import { getVertexClient } from '@/lib/cover-vision'

const MODEL_ID = 'gemini-2.5-flash-lite'
const LOCATION = 'us-central1'
const TIMEOUT_MS = 8000
const MAX_LEN = 700

export type DescribeInput = {
  title: string
  author?: string | null
  translator?: string | null
  publisher?: string | null
  category?: string | null
  publish_year?: number | string | null
  language?: string | null
  /** หมายเหตุจากผู้ขาย (ข้อความจริงจากคน) — ใช้เป็นบริบท ไม่คัดลอก */
  notes?: string[]
}

export function isDescriptionEnabled(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64
}

const PROMPT = `คุณคือบรรณาธิการร้านหนังสือมือสองในไทย เขียนย่อหน้า "เกี่ยวกับหนังสือ" สั้นๆ สำหรับหน้าเว็บ

กติกาเคร่งครัด:
1. ใช้เฉพาะข้อมูลที่ให้ด้านล่าง และสิ่งที่อนุมานได้อย่างปลอดภัยจากชื่อหนังสือ/หมวด/สำนักพิมพ์ (เช่น ประเภทหนังสือ กลุ่มผู้อ่าน)
2. ห้ามแต่งเนื้อเรื่อง ตัวละคร รางวัล ยอดขาย ตัวเลข ปีที่ไม่มีในข้อมูล หรือรายละเอียดที่ไม่แน่ใจ
3. ถ้าข้อมูลน้อย ให้เขียนสั้นลง (1–2 ประโยค) ดีกว่าแต่งเพิ่ม
4. ไม่พูดถึงราคา สภาพหนังสือ หรือการซื้อขาย
5. ภาษาไทย อ่านง่าย 2–3 ประโยค รวมไม่เกิน 120 คำ ไม่ขึ้นต้นด้วย "หนังสือเล่มนี้" ทุกประโยค
6. ถ้าชื่อหนังสือไม่ใช่ชื่อหนังสือจริง (เช่น ข้อความสุ่ม) ให้ตอบ description เป็นสตริงว่าง

ตอบเป็น JSON เท่านั้น: {"description": "..."}`

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()
}

/**
 * คืนคำอธิบาย หรือ '' เมื่อโมเดลตอบแต่ใช้ไม่ได้ (เก็บ '' ลง DB = เคยลองแล้ว ไม่ต้องลองซ้ำ)
 * โยน error เมื่อเรียกโมเดลไม่สำเร็จ (network/quota) → ผู้เรียกควรปล่อย null ไว้ให้ลองใหม่ครั้งหน้า
 */
export async function generateBookDescription(input: DescribeInput): Promise<string> {
  const facts: string[] = [`ชื่อหนังสือ: ${input.title}`]
  if (input.author) facts.push(`ผู้แต่ง: ${input.author}`)
  if (input.translator) facts.push(`ผู้แปล: ${input.translator}`)
  if (input.publisher) facts.push(`สำนักพิมพ์: ${input.publisher}`)
  if (input.category) facts.push(`หมวด: ${input.category}`)
  if (input.publish_year) facts.push(`ปีที่พิมพ์: ${input.publish_year}`)
  if (input.language) facts.push(`ภาษา: ${input.language === 'th' ? 'ไทย' : input.language === 'en' ? 'อังกฤษ' : input.language}`)
  const notes = (input.notes || []).map(n => clean(n)).filter(n => n.length >= 15).slice(0, 3)
  if (notes.length) facts.push(`หมายเหตุจากผู้ขาย (บริบทเท่านั้น ห้ามคัดลอก): ${notes.map(n => `"${n.slice(0, 200)}"`).join(' | ')}`)

  const vertex = getVertexClient(LOCATION)
  const model = vertex.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 400 },
  })

  const call = model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nข้อมูลหนังสือ:\n${facts.join('\n')}` }] }],
  })
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('describe_timeout')), TIMEOUT_MS))
  const result = await Promise.race([call, timeout])

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  let parsed: { description?: unknown } = {}
  try { parsed = JSON.parse(stripFence(text)) } catch { return '' }
  const desc = typeof parsed.description === 'string' ? clean(parsed.description) : ''
  if (desc.length < 40) return ''
  if (/ไม่ทราบ|ไม่มีข้อมูล|ไม่สามารถ/.test(desc.slice(0, 40))) return ''
  return desc.length > MAX_LEN ? desc.slice(0, MAX_LEN).replace(/\s+\S*$/, '') + '…' : desc
}
