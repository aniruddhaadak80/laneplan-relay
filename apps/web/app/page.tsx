import Link from 'next/link'
import { PRODUCT, SURFACES } from '@/lib/product'

export default function HomePage() {
  const shipped = SURFACES.filter((s) => s.status === 'shipped')

  return (
    <>
      <section className="hero">
        <span className="eyebrow">v{PRODUCT.version}</span>
        <h1>{PRODUCT.name}</h1>
        <p>{PRODUCT.tagline}</p>
        <div>
          <Link href="/surfaces">See what ships →</Link>
        </div>
      </section>

      <section aria-labelledby="surfaces-heading">
        <h2 id="surfaces-heading" style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-4)' }}>
          What ships
        </h2>
        {shipped.length === 0 ? (
          <p className="state" data-kind="empty">
            No surfaces are registered yet.
          </p>
        ) : (
          <div className="grid">
            {shipped.map((surface) => (
              <article className="card" key={surface.id}>
                <span className="badge" data-tone="ok">
                  {surface.status}
                </span>
                <h3>{surface.title}</h3>
                <p>{surface.summary}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="design-heading" style={{ marginTop: 'var(--space-7)' }}>
        <h2 id="design-heading" style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-4)' }}>
          Design rules this app obeys
        </h2>
        <div className="grid">
          <article className="card">
            <h3>Tokens only</h3>
            <p>
              Every colour resolves through <code>styles/tokens.css</code>. A raw literal anywhere else fails{' '}
              <code>check:theme-tokens</code>.
            </p>
          </article>
          <article className="card">
            <h3>Server-rendered first</h3>
            <p>
              The content above is in the initial HTML. There is no client-side loading shell hiding an empty
              page.
            </p>
          </article>
          <article className="card">
            <h3>Three states, three designs</h3>
            <p>Loading, empty, and error are distinct components — never one box reused for all three.</p>
          </article>
        </div>
      </section>
    </>
  )
}
