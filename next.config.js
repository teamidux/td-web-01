/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['covers.openlibrary.org', 'books.google.com'],
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
          // HSTS — บังคับ HTTPS 1 ปี + preload (เพิ่ม subdomain ก็ได้ถ้า production)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // CSP — เบาๆ กัน XSS พื้นฐาน (unsafe-inline จำเป็นสำหรับ Next.js inline style)
          // frame-ancestors แทน X-Frame-Options ใน modern browser
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com https://apis.google.com https://connect.facebook.net",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https: http:",
              "media-src 'self' blob:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.line.me https://access.line.me https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://graph.facebook.com https://www.google.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com",
              "frame-src 'self' https://www.google.com https://*.firebaseapp.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
