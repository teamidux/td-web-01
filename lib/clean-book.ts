// ล้างชื่อหนังสือ + ชื่อผู้แต่ง/สำนักพิมพ์ ให้คลีน
// แปลจาก Python script — ลบขยะจาก SE-ED และแหล่งอื่น

/**
 * ล้างชื่อหนังสือ — ลบคำนำหน้า, วงเล็บท้าย, สื่อเสริม, โฆษณา
 */
export function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return ''
  let t = String(raw).trim()
  if (!t) return ''

  // 1. ลบคำนำหน้าประเภท "ชุด" หรือ "Set."
  t = t.replace(/^(Set\.|ชุด|แบบฝึก)\s*/i, '')

  // 2. ลบข้อมูลในวงเล็บทุกรูปแบบที่อยู่ "ท้ายประโยค"
  t = t.replace(/\s*[(\[{][^()]*?[)\]}]$/, '')

  // 3. ล้างสื่อเสริมและข้อความโฆษณา
  const patterns = [
    /\b\d+ED\b/i,
    /\bNew\s*Edition\b/i,
    /\bVol\.\d+\b/i,
    /\bBook\s*Set\b/i,
    /\bฉบับปรับปรุง\b/,
    /\bชุดรวม\b/,
    /\+\s*CD(?:-ROM)?/i,
    /\+\s*VCD/i,
    /\+\s*DVD/i,
    /\+\s*สีเมจิก/,
    /\(ใช้ร่วมกับ.*?\)/,
    /\(?ใช้ร่วมกับ.*?Pen\)?/,
    /\(?บรรจุกระเป๋า.*?\)?/,
    /สำหรับ\s*\d+\s*ปีขึ้นไป/,
    /\(P\)/,
    /\(H\)/,
  ]
  for (const p of patterns) {
    t = t.replace(p, '')
  }

  // 4. ล้างชื่อสำนักพิมพ์ MIS ที่ชอบพ่วงหน้าชื่อเรื่อง
  t = t.replace(/^\s*(MIS|เอ็มไอเอส)\s*[:|\-]\s*/i, '')

  // 5. ลบเครื่องหมายคั่นกลาง และจัดช่องว่าง
  t = t.replace(/\s*[:|\-]\s*/g, ' ')
  t = t.replace(/\s{2,}/g, ' ')

  return t.trim().replace(/^[,.\-/\s]+|[,.\-/\s]+$/g, '')
}

/**
 * ล้างชื่อผู้แต่ง / สำนักพิมพ์ — ลบ tag HTML, คำนำหน้าสำนักพิมพ์, ขยะ
 * ถ้าเป็นตัวเลขล้วน → return null (ข้อมูลผิด)
 */
export function cleanName(text: string | null | undefined): string | null {
  if (!text || text === 'None' || text === 'N/A' || text === 'n/a') return null
  let t = String(text).trim()

  // ตัวเลขล้วน → ข้อมูลผิด
  if (/^\d+$/.test(t)) return null

  // extract text จาก JSON-like string
  if (t.includes('"text":"')) {
    const parts = [...t.matchAll(/"text":"([^"]+)"/g)].map(m => m[1])
    if (parts.length) t = parts.join(' ')
  }

  // ลบ HTML tags
  t = t.replace(/<[^>]+>/g, '')

  // ลบคำนำหน้าสำนักพิมพ์
  t = t.replace(/,?\s*(สนพ\.?|สำนักพิมพ์|บจก\.?|บมจ\.?|จำกัด|มหาชน)/g, '')

  // ล้าง escape chars
  t = t.replace(/\\"/g, '"').replace(/\\/g, '').replace(/"/g, '')
  t = t.replace(/[{}\[\]]/g, '')

  t = t.trim().replace(/^[,.\-\s]+|[,.\-\s]+$/g, '')
  return t || null
}

/**
 * ล้างชื่อผู้แต่ง — cleanName + กรองค่าที่ไม่ใช่ชื่อคนออก
 * เช่น SE-ED ใส่คำอธิบายหนังสือมาแทนชื่อผู้แต่ง
 */
export function cleanAuthor(text: string | null | undefined): string | null {
  const name = cleanName(text)
  if (!name) return null

  // กรองค่าที่ไม่ใช่ชื่อคนจริง — เป็นคำอธิบาย/หมวดหมู่ที่ SE-ED ใส่ผิด column
  const junkPatterns = [
    /หนังสือ/,
    /พร้อมสื่อ/,
    /การเรียนรู้/,
    /แบบฝึก/,
    /แบบเรียน/,
    /คู่มือ/,
    /ฝ่ายวิชาการ/,
    /กองบรรณาธิการ/,
    /ทีมงาน/,
    /บริษัท/,
    /สำนักพิมพ์/,
    /^-$/,
    /^\.$/,
  ]
  for (const p of junkPatterns) {
    if (p.test(name)) return null
  }

  return name
}

/**
 * ล้างชื่อสำนักพิมพ์ — cleanName + กรองค่าที่ไม่ใช่สำนักพิมพ์จริง
 */

/**
 * ล้างชื่อสำนักพิมพ์ — เหมือน cleanName + ลบ N/A
 */
export function cleanPublisher(text: string | null | undefined): string | null {
  if (!text || text === 'N/A' || text === 'n/a' || text === 'None') return null
  const name = cleanName(text)
  if (!name) return null

  // กรองค่าที่ไม่ใช่สำนักพิมพ์จริง
  const junkPatterns = [
    /^ฝ่ายวิชาการ$/,
    /^กองบรรณาธิการ$/,
    /^ทีมงาน$/,
    /^-$/,
    /^\.$/,
  ]
  for (const p of junkPatterns) {
    if (p.test(name)) return null
  }

  return name
}
