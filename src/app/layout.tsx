import type { Metadata } from "next";
import Link from "next/link";
import BrowserWarning from "@/components/BrowserWarning";
import "./globals.css";

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
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900" suppressHydrationWarning>
        <BrowserWarning />
        <nav className="border-b border-gray-100 px-4 py-3 flex items-center justify-between max-w-2xl mx-auto w-full">
          <Link href="/" className="font-bold text-blue-600 text-sm tracking-tight">English Practice</Link>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700 text-sm transition-colors">Admin</Link>
            <Link href="/history" className="text-gray-500 hover:text-gray-700 text-sm transition-colors">History</Link>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
