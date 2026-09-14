import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';

/**
 * One superfamily, three roles: Plex Sans runs the interface, Plex Serif sets
 * the formal decision record and the report so the record reads differently
 * from the tooling around it, and Plex Mono is reserved for references.
 *
 * The fonts are self-hosted rather than pulled from Google at build time. That
 * keeps the build offline-capable, avoids a third-party request on every page
 * load, and means a Google outage cannot break a deploy.
 */
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-serif/400.css';
import '@fontsource/ibm-plex-serif/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Technical Decision Authority',
  description: 'Record, review and account for technical decisions.',
};

export const viewport: Viewport = {
  themeColor: '#16222E',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
