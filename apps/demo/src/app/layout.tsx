import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { COLOR_SCHEME_COOKIE, parseColorScheme } from '@kitto/ui/themes';
import { SkipLink, ThemeStyle, htmlThemeAttr } from '@kitto/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Kitto Demo', template: '%s · Kitto Demo' },
  description: 'An example multi-tenant app built with the Kitto framework.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const scheme = parseColorScheme((await cookies()).get(COLOR_SCHEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={htmlThemeAttr(scheme)}>
      <head>
        <ThemeStyle />
      </head>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
