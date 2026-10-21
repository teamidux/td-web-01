// Google Search Console API (อ่านอย่างเดียว) — ใช้ service account ตัวเดียวกับ Vertex AI
// ต้องเพิ่มอีเมลของ service account เป็น user ใน Search Console property ก่อน (สิทธิ์ Restricted พอ)
import { GoogleAuth } from 'google-auth-library'

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

function creds(): { client_email: string; private_key: string; project_id: string } {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_B64 not set')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

export function gscServiceEmail(): string | null {
  try { return creds().client_email } catch { return null }
}

let cachedToken: { token: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token
  const auth = new GoogleAuth({ credentials: creds(), scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] })
  const client = await auth.getClient()
  const t = await client.getAccessToken()
  if (!t.token) throw new Error('gsc_no_token')
  cachedToken = { token: t.token, exp: Date.now() + 50 * 60_000 }
  return t.token
}

async function gscFetch(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`gsc_${r.status}: ${text.slice(0, 200)}`)
  }
  return r.json()
}

let cachedSite: string | null = null
/** หา property ของ bookmatch.app ที่ service account มีสิทธิ์ (ชอบ sc-domain ก่อน) */
export async function gscResolveSite(): Promise<string> {
  if (cachedSite) return cachedSite
  const data = await gscFetch('/sites')
  const entries: { siteUrl: string; permissionLevel: string }[] = data.siteEntry || []
  const mine = entries.filter(e => /bookmatch\.app/i.test(e.siteUrl) && e.permissionLevel !== 'siteUnverifiedUser')
  const pick = mine.find(e => e.siteUrl.startsWith('sc-domain:')) || mine[0]
  if (!pick) throw new Error('gsc_no_access')
  cachedSite = pick.siteUrl
  return cachedSite
}

export async function gscQuery(args: {
  startDate: string; endDate: string; dimensions: string[]; rowLimit?: number
  dimensionFilterGroups?: unknown[]
}): Promise<GscRow[]> {
  const site = await gscResolveSite()
  const data = await gscFetch(`/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({ ...args, rowLimit: args.rowLimit ?? 100, dataState: 'final' }),
  })
  return (data.rows || []) as GscRow[]
}
