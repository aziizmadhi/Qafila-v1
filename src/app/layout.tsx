import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { SceneHost } from "@/components/SceneHost";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

// Self-hosted by next/font at build time: no requests to Google from players' browsers.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "قافلة", template: "%s · قافلة" },
  description: "لعبة أسئلة يومية: سبعة أسئلة، وكلما كانت إجابتك أندر قطعت قافلتك مسافة أبعد في الصحراء.",
  applicationName: "قافلة",
  appleWebApp: { capable: true, title: "قافلة", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#2d2448",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body className="font-sans antialiased">
        <SceneHost />
        <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
          {children}
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
