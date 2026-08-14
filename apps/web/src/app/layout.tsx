import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gavel XI — Build the XI. Break the Bank.',
  description: 'A live multiplayer football squad auction.',
  applicationName: 'Gavel XI',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Gavel XI',
  },
  icons: {
    icon: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#080a09',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
