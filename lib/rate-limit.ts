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
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}
