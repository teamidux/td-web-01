// กัน open redirect หลัง login: ?next= ต้องเป็น path ภายในเว็บเท่านั้น
// เคสที่ต้องกัน: "@evil.com" ".evil.com" ":443@evil.com" (ต่อท้าย https://bookmatch.app แล้วกลายเป็นโดเมนอื่น)
// และ "//evil.com" "/\evil.com" (protocol-relative) — ทั้งหมดตกเป็น fallback
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || typeof value !== 'string') return fallback
  if (value.length > 500) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\x00-\x1f\x7f\s]/.test(value)) return fallback
  return value
}
