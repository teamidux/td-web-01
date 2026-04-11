// Next.js 14 auto-serves this at /opengraph-image.png
// ใช้เป็น OG image default ของทุก page ที่ไม่ override
// Metadata ใน layout.tsx จะ auto-pick up ไม่ต้องใส่ openGraph.images
import { ImageResponse } from 'next/og'
import fs from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'
export const alt = 'BookMatch — ตลาดหนังสือมือสอง'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  // ใช้ logo2.png (horizontal 1536×1024 — มี 'BookMatch' text อยู่แล้ว)
  const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
  const logoBuffer = await fs.readFile(logoPath).catch(() => null)
  const logoDataUri = logoBuffer
    ? `data:image/png;base64,${logoBuffer.toString('base64')}`
    : null

  // Load Thai font (Kanit Bold) — ต้องใช้ TTF เพราะ satori ไม่รองรับ woff2
  // ดึงจาก Google Fonts GitHub repo (serve raw TTF)
  let fontBuffer: ArrayBuffer | null = null
  try {
    const fontRes = await fetch(
      'https://raw.githubusercontent.com/google/fonts/main/ofl/kanit/Kanit-Bold.ttf'
    )
    if (fontRes.ok) fontBuffer = await fontRes.arrayBuffer()
  } catch {
    // Font load failed — fallback to default (Thai อาจเพี้ยน)
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #F0F9FF 0%, #DBEAFE 60%, #BFDBFE 100%)',
          padding: 40,
        }}
      >
        {/* Logo 2 — horizontal มี BookMatch text baked in */}
        {logoDataUri && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoDataUri}
            alt="BookMatch"
            width={660}
            height={440}
            style={{ marginBottom: 20 }}
          />
        )}

        {/* Tagline ภาษาไทย */}
        <div
          style={{
            fontSize: 38,
            fontWeight: 700,
            color: '#1E3A8A',
            fontFamily: fontBuffer ? 'Kanit' : 'sans-serif',
            marginBottom: 20,
          }}
        >
          ตลาดหนังสือมือสองออนไลน์
        </div>

        {/* URL pill */}
        <div
          style={{
            fontSize: 22,
            color: '#2563EB',
            background: 'rgba(255,255,255,.85)',
            padding: '10px 28px',
            borderRadius: 999,
            fontFamily: fontBuffer ? 'Kanit' : 'sans-serif',
            fontWeight: 700,
            border: '2px solid #BFDBFE',
          }}
        >
          bookmatch.app
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontBuffer
        ? [{ name: 'Kanit', data: fontBuffer, weight: 700, style: 'normal' }]
        : undefined,
    }
  )
}
