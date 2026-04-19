// Cover Vision — ใช้ Vertex AI Gemini อ่านหน้าปกหนังสือ
// Shared library: /api/test/cover-scan และ /api/test/sell-flow/scan เรียกใช้
// ใช้เครดิต Google Cloud (Vertex AI) ไม่ใช่ Gemini API Billing
import { VertexAI } from '@google-cloud/vertexai'

export type CoverExtractionResult = {
  title: string | null
  subtitle: string | null
  authors: string[] | null
  publisher: string | null
  language: 'th' | 'en' | 'other' | null
  edition: string | null
  confidence: 'high' | 'medium' | 'low'
  notes: string | null
}

export const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

// บาง model ยังไม่ deploy ทุก region — map ตาม availability (Apr 2026)
// us-central1 = universal; asia-southeast1 = SEA1 latency ต่ำจากไทย (เฉพาะ Flash)
export const MODEL_REGION: Record<string, string> = {
  'gemini-2.5-flash':      'asia-southeast1',
  'gemini-2.5-flash-lite': 'us-central1',
  'gemini-2.5-pro':        'us-central1',
}
export const ALLOWED_MODELS = new Set(Object.keys(MODEL_REGION))

const PROMPT = `คุณคือผู้เชี่ยวชาญอ่านหน้าปกหนังสือทั้งภาษาไทยและอังกฤษ
ภาพที่ให้มาคือหน้าปกหนังสือ 1 เล่ม
return JSON ตาม schema นี้เท่านั้น ห้ามมี text อื่น ห้ามใช้ markdown code fence:

{
  "title": "ชื่อหนังสือหลัก หรือ null",
  "subtitle": "ชื่อรอง หรือ null",
  "authors": ["ชื่อผู้แต่ง"] หรือ null,
  "publisher": "สำนักพิมพ์ หรือ null",
  "language": "th | en | other หรือ null",
  "edition": "พิมพ์ครั้งที่ X หรือ null",
  "confidence": "high | medium | low",
  "notes": "ข้อสังเกต หรือ null"
}

กฎเข้ม:
- ทุก field ยกเว้น confidence เป็น null ได้ถ้าอ่านไม่เจอจริงๆ
- ห้ามเดาเด็ดขาด: อ่านไม่ออก/ไม่เห็น → null เสมอ
- ชื่อผู้แต่งไทย: รักษาการสะกดเดิม ห้ามแปลงเป็น romanization
- edition: ถ้าปกใช้เลขไทย (๑๒๓) ให้แปลงเป็นเลขอารบิก (1,2,3)
  เพราะ user ค้นด้วยเลขอารบิก
- confidence = low ถ้าเบลอ/มืด/เอียงมาก/ตัวอักษรถูกบัง
- confidence = medium ถ้าอ่านได้บางส่วน/ปกถูกตัดออก
- confidence = high เฉพาะเมื่ออ่านได้ครบและชัดเจน
- language: ดูภาษาของ title หลัก แต่ถ้าเป็นหนังสือแปลไทย
  (publisher ไทย + มีชื่อรองภาษาไทย) ให้ language = "th"
- ห้ามทำซ้ำคำ/วลีเดียวกันใน title (เช่น "ฮวงจุ้ยฮวงจุ้ย") ถ้าปกมี
  คำเดียว ก็ใส่คำเดียว ห้ามซ้ำเพื่อ "เติม"`

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

// cache VertexAI client ต่อ location — กัน cold-start แต่ละ region
const clientCache = new Map<string, VertexAI>()

function getClient(location: string): VertexAI {
  const cached = clientCache.get(location)
  if (cached) return cached
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_B64 not set')
  const json = Buffer.from(b64, 'base64').toString('utf8')
  const credentials = JSON.parse(json) as { project_id: string; client_email: string; private_key: string }
  const project = process.env.GOOGLE_CLOUD_PROJECT || credentials.project_id
  const client = new VertexAI({
    project,
    location,
    googleAuthOptions: { credentials },
  })
  clientCache.set(location, client)
  return client
}

export type ExtractResult = {
  model: string
  location: string
  duration_ms: number
  raw: string
  parsed: CoverExtractionResult | null
  parseError: string | null
}

export async function extractFromCover(args: {
  imageBase64: string
  mimeType: string
  modelId?: string
}): Promise<ExtractResult> {
  const model_id = args.modelId && ALLOWED_MODELS.has(args.modelId) ? args.modelId : DEFAULT_MODEL
  const location = MODEL_REGION[model_id]
  const t0 = Date.now()

  const vertex = getClient(location)
  const model = vertex.getGenerativeModel({
    model: model_id,
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  })

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: args.imageBase64, mimeType: args.mimeType } },
        { text: PROMPT },
      ],
    }],
  })
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const duration_ms = Date.now() - t0

  let parsed: CoverExtractionResult | null = null
  let parseError: string | null = null
  try {
    parsed = JSON.parse(stripFence(text))
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'parse_failed'
  }

  return { model: model_id, location, duration_ms, raw: text, parsed, parseError }
}
