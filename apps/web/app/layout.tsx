import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { PRODUCT } from '@/lib/product'
import './globals.css'

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: PRODUCT.tagline,
  metadataBase: new URL(PRODUCT.repoUrl),
  openGraph: {
    title: PRODUCT.name,
    description: PRODUCT.tagline,
    url: PRODUCT.repoUrl,
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Loaded at runtime rather than build time so the production build never blocks on a
            font CDN, and so the page still renders correctly when it is unreachable. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Roboto+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <div className="shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {PRODUCT.name}
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">Overview</Link>
                <Link href="/workspace">Workspace</Link>
                <Link href="/surfaces">Surfaces</Link>
                <Link href="/health">Health</Link>
                <a
                  href={PRODUCT.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View the source on GitHub"
                >
                  GitHub
                </a>
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container">
              <span>
                {PRODUCT.name} v{PRODUCT.version} — MIT. Deterministic core, extensible surface.
              </span>
              <a
                href={PRODUCT.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View the source on GitHub"
              >
                View source
              </a>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
