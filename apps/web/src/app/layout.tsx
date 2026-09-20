import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './transfer-room.css';
import './scouting-room.css';
import './broadcast-room.css';
import './tactical-pitch.css';
import './audio-controls.css';

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
  themeColor: '#001d4a',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
