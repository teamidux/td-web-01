// LINE Messaging API helpers
// ใช้กับ BookMatch Official Account (สร้างผ่าน LINE Developers Console)
//
// Env vars ที่ต้อง set:
//   LINE_OA_CHANNEL_SECRET       — Channel secret (สำหรับ verify webhook signature)
//   LINE_OA_CHANNEL_ACCESS_TOKEN — Channel access token (สำหรับ push/reply messages)
//
// Free quota: 200 push messages/เดือน — ระวังใช้ trigger ที่ไม่จำเป็น

const LINE_API = 'https://api.line.me/v2/bot'

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'sticker'; packageId: string; stickerId: string }

/**
 * Push message ไปหา user ที่ add OA เป็นเพื่อนแล้ว
 * นับเป็น "push" → กิน free quota (200/เดือน)
 *
 * @returns success: true ถ้าส่งสำเร็จ
 */
export async function pushLineMessage(
  toUserId: string,
  messages: LineMessage[]
): Promise<{ success: boolean; status?: number; error?: string }> {
  const token = process.env.LINE_OA_CHANNEL_ACCESS_TOKEN
  if (!token) return { success: false, error: 'LINE_OA_CHANNEL_ACCESS_TOKEN not set' }
  if (!toUserId || !messages.length) return { success: false, error: 'invalid params' }

  try {
    const r = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: toUserId, messages: messages.slice(0, 5) }),
    })
    if (r.status === 200) return { success: true, status: 200 }
    const body = await r.text().catch(() => '')
    console.warn('[line-bot] push failed', r.status, body.slice(0, 200))
    return { success: false, status: r.status, error: body.slice(0, 200) }
  } catch (err: any) {
    console.error('[line-bot] push exception', err?.message || err)
    return { success: false, error: String(err?.message || err) }
  }
}

/** Shortcut: push text-only message */
export function pushLineText(toUserId: string, text: string) {
  return pushLineMessage(toUserId, [{ type: 'text', text }])
}

/**
 * Reply message — ใช้ตอบ event ที่มี replyToken (เช่น user ส่งข้อความมา)
 * "ฟรี" ไม่นับ push quota — ใช้ได้บ่อยกว่า
 * Reply token ใช้ได้ครั้งเดียวภายใน 1 นาทีหลัง event
 */
export async function replyLineMessage(
  replyToken: string,
  messages: LineMessage[]
): Promise<{ success: boolean; error?: string }> {
  const token = process.env.LINE_OA_CHANNEL_ACCESS_TOKEN
  if (!token) return { success: false, error: 'LINE_OA_CHANNEL_ACCESS_TOKEN not set' }

  try {
    const r = await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    })
    if (r.status === 200) return { success: true }
    const body = await r.text().catch(() => '')
    return { success: false, error: `${r.status}: ${body.slice(0, 200)}` }
  } catch (err: any) {
    return { success: false, error: String(err?.message || err) }
  }
}

/**
 * Verify HMAC-SHA256 signature จาก LINE webhook
 * LINE ส่ง header `x-line-signature` มา → compare กับ HMAC ของ raw body
 * ใช้ Web Crypto API → รัน Edge runtime ได้
 */
export async function verifyLineSignature(rawBody: string, signature: string): Promise<boolean> {
  const secret = process.env.LINE_OA_CHANNEL_SECRET
  if (!secret || !signature) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  // base64 encode
  const bytes = new Uint8Array(sig)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const expected = btoa(bin)
  // Constant-time comparison — กัน timing attack (manual เพราะ Edge runtime ไม่มี timingSafeEqual)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
