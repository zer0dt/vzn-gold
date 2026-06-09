import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import SharedLayout from "./components/layout/SharedLayout";
import { Providers } from './providers'
import { ThemeProvider } from "@/app/components/theme-provider"
import { Toaster } from "@/app/components/ui/toaster"
import { Suspense } from 'react'
import { Loader2 } from "lucide-react"
import { WalletProvider } from "@/app/hooks/use-wallet";
import { AuthProvider } from "@/app/contexts/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Add Bitcount Prop Single font
const bitcountPropSingle = localFont({
  src: './BitcountPropSingle.ttf',
  variable: '--font-bitcount-prop-single',
  display: 'swap',
});

const yeezyFont = localFont({
  src: './yeezy.ttf',
  variable: '--font-yeezy',
  display: 'swap',
});

const vznHeadingsFont = localFont({
  src: '../public/fonts/vzn_headings.woff',
  variable: '--font-vzn-headings-local',
  display: 'block',
});

const baseUrl = process.env.NODE_ENV === 'production' 
  ? 'https://vzn.gold' 
  : 'http://localhost:3000'

export const metadata: Metadata = {
  title: "VZN.gold - Lock Satoshis and Earn $VZN",
  description: "Lock Satoshis and Earn $VZN",
  applicationName: "VZN.gold",
  metadataBase: new URL(baseUrl),
  appleWebApp: {
    title: "VZN.gold",
    statusBarStyle: "black-translucent",
    capable: true,
  },
  openGraph: {  
    title: "VZN.gold - Lock Satoshis and Earn $VZN",
    description: "Lock Satoshis and Earn $VZN",
    url: "https://VZN.gold",
    siteName: "VZN.gold",
    type: "website",
    images: [
      {
        url: "https://fbx-public.s3.us-east-1.amazonaws.com/vzn-opengraph.png",
        width: 1200,
        height: 630,
        alt: "VZN.gold - Lock Satoshis and Earn $VZN"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "VZN.gold",
    description: "Lock Satoshis and Earn $VZN",
    images: ["https://fbx-public.s3.us-east-1.amazonaws.com/vzn-opengraph.png"]
  },
  other: {
    'telegram-channel': '@Yeezy_Gold',
    'og:image': "https://fbx-public.s3.us-east-1.amazonaws.com/vzn-opengraph.png",
    'og:site_name': 'VZN.gold',
    'og:type': 'website',
    'og:image:width': '1200',
    'og:image:height': '630',
    'apple-mobile-web-app-status-bar-style': 'black-translucent'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} ${bitcountPropSingle.variable} ${yeezyFont.variable} ${vznHeadingsFont.variable}`}
    >
      <body className="antialiased bg-background">
        <Providers>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              <WalletProvider>
                <SharedLayout>
                  <Suspense fallback={
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
                    </div>
                  }>
                    {children}
                  </Suspense>
                </SharedLayout>
              </WalletProvider>
            </AuthProvider>
            <Toaster />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
