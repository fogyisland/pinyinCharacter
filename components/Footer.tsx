import Link from 'next/link';
import Image from 'next/image';
import { BRAND, FOOTER_LINKS } from '@/lib/design';

export function Footer() {
  return (
    <footer className="border-t-4 border-seal mt-16 bg-ink text-paper-soft">
      <div className="max-w-7xl mx-auto px-5 py-10 sm:px-8 lg:px-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/logo-sm.webp"
              alt={BRAND.name}
              width={40}
              height={40}
              className="rounded-full"
            />
            <div>
              <div className="font-kai text-2xl">{BRAND.name}</div>
              <p className="text-sm text-paper/85 mt-1">{BRAND.shortDesc}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {FOOTER_LINKS.map((link) => {
              const isExternal = 'external' in link && link.external === true;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-paper hover:underline underline-offset-4"
                  {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="my-6 border-t border-paper/25" />
        <p className="text-xs text-paper/80">{BRAND.copyright}</p>
      </div>
    </footer>
  );
}
