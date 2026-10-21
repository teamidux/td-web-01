// "หนังสือไทย" สำหรับ SEO/catalog อัตโนมัติ (ตัดสินใจ 2026-10-21)
// ทำไม: catalog ที่เติมอัตโนมัติจาก Google Books มีหนังสือต่างประเทศ ~1/3 ที่คนไทยไม่ค้น
// → Google มองเป็นหน้าบาง ไม่ index และเปลือง crawl budget
// เล่มที่ผู้ขายลงเอง (community/vision) ไม่ผ่านตัวกรองนี้ — ขายหนังสืออังกฤษได้ตามปกติ
//
// language ใน DB ไม่น่าเชื่อถือ (auto-cache ใส่ 'th' ให้ทุกเล่ม) → ดูจากตัวอักษรไทยในชื่อ หรือ ISBN ไทย
const THAI_CHAR = /[฀-๿]/
const THAI_ISBN_PREFIX = /^978(616|974)/

export function isThaiBook(b: { isbn?: string | null; title?: string | null }): boolean {
  if (b.isbn && THAI_ISBN_PREFIX.test(b.isbn)) return true
  if (b.title && THAI_CHAR.test(b.title)) return true
  return false
}
