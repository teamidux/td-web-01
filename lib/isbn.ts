// ตรวจ ISBN-13 ด้วย checksum (EAN-13) — ISBN จริงทุกเล่มผ่าน, เลขมั่ว/พิมพ์ผิดส่วนใหญ่ไม่ผ่าน
export function isValidIsbn13(s: string): boolean {
  if (!/^(978|979)\d{10}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10 === Number(s[12])
}
