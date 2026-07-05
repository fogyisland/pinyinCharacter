import Link from 'next/link';
import Image from 'next/image';
import { BRAND, FOOTER_LINKS } from '@/lib/design';

export function Footer() {
  return (
    <footer className="border-t border-ink/10 mt-16 bg-paper-soft/60">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt={BRAND.name} width={40} height={40} className="rounded-full" />
            <div>
              <div className="font-kai text-lg text-ink">{BRAND.name}</div>
              <p className="text-xs text-ink-soft mt-1">{BRAND.shortDesc}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {FOOTER_LINKS.map(link => {
              const isExternal = 'external' in link && link.external === true;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-ink-soft hover:text-seal transition-colors"
                  {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="paper-rule my-6" />
        <p className="text-xs text-ink-faint">{BRAND.copyright}</p>
      </div>
    </footer>
  );
}
