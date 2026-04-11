// PWA icon generator — ใช้ logo.png (square 1080×1080) เป็น source
// ?size=192 / 512 / 180 → resize ให้พอดี พร้อม white background สำหรับ maskable
import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const size = Number(req.nextUrl.searchParams.get('size') || 192)

  // Load logo2 (square 1080×1080 — เหมาะกับ icon)
  const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
  const logoBuffer = await fs.readFile(logoPath).catch(() => null)
  const logoDataUri = logoBuffer
    ? `data:image/png;base64,${logoBuffer.toString('base64')}`
    : null

  // Maskable icon pattern: ใส่ safe area 10% รอบ ๆ ป้องกัน crop โดย OS
  // (iOS/Android บางตัวกรอบ icon เป็นวงกลม/squircle)
  const innerSize = Math.round(size * 0.82)

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: 'white',
          borderRadius: size * 0.2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {logoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoDataUri}
            alt="BookMatch"
            width={innerSize}
            height={innerSize}
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <div style={{ color: '#2563EB', fontSize: size * 0.2, fontWeight: 800 }}>BM</div>
        )}
      </div>
    ),
    { width: size, height: size }
  )
}
