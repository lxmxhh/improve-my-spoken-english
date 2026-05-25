import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import BrowserWarning from "@/components/BrowserWarning";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "English Practice",
  description: "Daily English speaking practice with your AI coach",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <BrowserWarning />
        <nav className="border-b border-gray-100 px-4 py-3 flex items-center justify-between max-w-2xl mx-auto w-full">
          <Link href="/" className="font-bold text-blue-600 text-sm tracking-tight">English Practice</Link>
          <Link href="/history" className="text-gray-500 hover:text-gray-700 text-sm transition-colors">History</Link>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
