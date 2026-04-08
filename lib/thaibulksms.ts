// Thin client for thaibulksms.com OTP API.
// Docs: https://developer.thaibulksms.com/

const API_KEY = process.env.THAIBULKSMS_API_KEY
const API_SECRET = process.env.THAIBULKSMS_API_SECRET
const SENDER = process.env.THAIBULKSMS_SENDER || 'BookMatch'

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
}

// Normalize Thai phone: 0812345678 → 66812345678 (international format Thaibulksms expects)
export function normalizeThaiPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('66')) return digits
  if (digits.startsWith('0')) return '66' + digits.slice(1)
  return digits
}

export async function sendSMS(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!API_KEY || !API_SECRET) {
    return { ok: false, error: 'Thaibulksms not configured' }
  }
  const params = new URLSearchParams({
    msisdn: normalizeThaiPhone(phone),
    message,
    sender: SENDER,
    force: 'standard',
  })
  try {
    const r = await fetch('https://api-v2.thaibulksms.com/sms', {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return { ok: false, error: `SMS failed (${r.status}): ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' }
  }
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}
