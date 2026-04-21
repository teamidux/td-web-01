// Simple in-memory rate limiter (per IP)
// สำหรับ protect public endpoints จาก abuse
// Note: In-memory = per-instance → Vercel serverless อาจ cold start reset
// ใช้สำหรับ protect เบาๆ — ไม่ใช่ security ชั้นสุดท้าย

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * เช็คว่า key นี้เกิน limit ไหม
 * @param key — ตัวแทน identity (IP หรือ user id)
 * @param limit — จำนวนครั้งสูงสุด
 * @param windowMs — ระยะเวลา window (ms)
 * @returns true ถ้ายังไม่เกิน, false ถ้าเกินแล้ว (block)
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count++
  return true
}

/** ดึง IP จาก NextRequest headers */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

/** Cleanup old buckets (เรียกเป็น setInterval ถ้าต้องการ) */
export function cleanupRateLimit() {
  const now = Date.now()
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt < now) buckets.delete(key)
  })
}

/** คืนจำนวนวินาทีจน bucket reset (0 ถ้าไม่มี bucket หรือหมดอายุแล้ว) */
export function getRateLimitResetIn(key: string): number {
  const bucket = buckets.get(key)
  if (!bucket) return 0
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000))
}

/**
 * 2-tier rate limit (burst + sustained) สำหรับ action ของ user
 * - burst: กัน bot ยิงเร็ว (เช่น 15/นาที)
 * - sustained: กัน marathon (เช่น 300/ชม)
 *
 * ถ้าติด limit ใด limit หนึ่ง คืน { ok: false, message } ที่เป็นภาษาคน
 * Human ลงต่อเนื่องจริงๆ 3-5/min จะไม่ชน
 */
export function checkUserActionLimit(
  userId: string,
  action: string,
  opts: { perMin: number; perHr: number; actionLabel?: string } = { perMin: 15, perHr: 300 }
): { ok: true } | { ok: false; message: string; retryAfter: number } {
  const label = opts.actionLabel || 'ลงขาย'
  const minKey = `${action}-min:${userId}`
  if (!checkRateLimit(minKey, opts.perMin, 60_000)) {
    const retryAfter = getRateLimitResetIn(minKey)
    return {
      ok: false,
      retryAfter,
      message: `${label}ต่อเนื่องเร็วมาก! พัก ${retryAfter} วินาที แล้วลองต่อได้เลย (ระบบกันบอทสแปม)`,
    }
  }
  const hrKey = `${action}-hr:${userId}`
  if (!checkRateLimit(hrKey, opts.perHr, 3_600_000)) {
    const retryAfter = getRateLimitResetIn(hrKey)
    const mins = Math.ceil(retryAfter / 60)
    return {
      ok: false,
      retryAfter,
      message: `${label}ครบ ${opts.perHr} เล่มใน 1 ชั่วโมงแล้ว — พักอีก ~${mins} นาที หรือทักทีมเราที่ LINE OA ถ้ามีเหตุจำเป็น`,
    }
  }
  return { ok: true }
}
