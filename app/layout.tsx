import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { PwaRegister } from '@/components/shared/pwa-register';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Counselling CRM',
  description: 'Lead management system for KollegeApply counselling teams',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Counselling CRM',
  },
  icons: {
    icon: '/api/pwa/icon/192',
    apple: '/api/pwa/icon/192',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d2455',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
