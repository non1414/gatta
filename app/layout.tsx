import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "قِطّة - قسّم الحساب مع أصدقائك",
  description: "خدمة لتنظيم المدفوعات الجماعية بين الأصدقاء. رابط واحد، متابعة المدفوعات، وعدّ تنازلي للموعد.",
  openGraph: {
    title: "قِطّة - قسّم الحساب مع أصدقائك",
    description: "خدمة لتنظيم المدفوعات الجماعية بين الأصدقاء",
    locale: "ar_SA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
