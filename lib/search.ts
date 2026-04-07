// Map ตัวเลขอารบิก → คำไทย และกลับกัน
const ARABIC_TO_THAI: Record<string, string> = {
  '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม',
  '4': 'สี่', '5': 'ห้า', '6': 'หก', '7': 'เจ็ด',
  '8': 'แปด', '9': 'เก้า',
}
const THAI_TO_ARABIC: Array<[RegExp, string]> = [
  [/ศูนย์/g, '0'], [/หนึ่ง/g, '1'], [/สอง/g, '2'], [/สาม/g, '3'],
  [/สี่/g, '4'], [/ห้า/g, '5'], [/หก/g, '6'], [/เจ็ด/g, '7'],
  [/แปด/g, '8'], [/เก้า/g, '9'],
]

/**
 * สร้าง query variants เพื่อ fuzzy search:
 * - ตัวเลขอารบิก ↔ คำไทย  (4 ↔ สี่)
 * - มีช่องว่าง / ไม่มีช่องว่าง
 */
export function searchVariants(q: string): string[] {
  const base = q.trim().replace(/\s+/g, ' ')
  const set = new Set<string>()

  const add = (s: string) => {
    const t = s.trim()
    if (t.length >= 1) {
      set.add(t)
      // เพิ่มแบบไม่มี space ถ้าต่างจากต้นฉบับ
      const noSpace = t.replace(/\s/g, '')
      if (noSpace !== t) set.add(noSpace)
    }
  }

  add(base)

  // อารบิก → ไทย (เช่น "4 แผ่นดิน" → "สี่ แผ่นดิน" → "สี่แผ่นดิน")
  const toThai = base.replace(/[0-9]/g, d => ARABIC_TO_THAI[d] ?? d)
  if (toThai !== base) add(toThai)

  // ไทย → อารบิก (เช่น "สี่แผ่นดิน" → "4แผ่นดิน")
  let toArabic = base
  for (const [re, digit] of THAI_TO_ARABIC) toArabic = toArabic.replace(re, digit)
  if (toArabic !== base) add(toArabic)

  // กรณี toThai มี space ต้องลอง toThai ไม่มี space ด้วย
  if (toThai !== base) {
    let tt = toThai
    for (const [re, digit] of THAI_TO_ARABIC) tt = tt.replace(re, digit)
    if (tt !== toThai) add(tt)
  }

  return Array.from(set)
}

/**
 * สร้าง Supabase .or() string จาก variants
 * columns: ['title', 'author']
 */
export function buildOrFilter(variants: string[], columns = ['title', 'author']): string {
  return variants
    .flatMap(v => columns.map(col => `${col}.ilike.%${v}%`))
    .join(',')
}
