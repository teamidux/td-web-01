// Next.js auto-serves at /twitter-image.png
// Reuse OG image generator — ต้อง duplicate metadata exports
// เพราะ Next.js ต้องการ string literal (re-export ไม่ทำงาน)
export { default } from './opengraph-image'

export const runtime = 'nodejs'
export const alt = 'BookMatch — ตลาดหนังสือมือสอง'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
