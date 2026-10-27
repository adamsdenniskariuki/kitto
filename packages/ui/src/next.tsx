'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './components';

export interface NavItem {
  href: string;
  label: string;
  /** Match only the exact path (for "home" links). */
  exact?: boolean;
}

/** Horizontal navigation with aria-current on the active link. Scrolls sideways on phones. */
export function NavLinks({ items, label }: { items: readonly NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
      {items.map(({ href, label: text, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted hover:text-ink',
              'aria-[current=page]:border-brand aria-[current=page]:text-ink',
            )}
          >
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
