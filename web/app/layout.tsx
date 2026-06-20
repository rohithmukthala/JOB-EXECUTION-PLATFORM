import "./globals.css";
import Link from "next/link";
import { Providers } from "./providers";

export const metadata = { title: "Job Platform" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <nav className="flex gap-4 border-b bg-white px-6 py-3 text-sm font-medium">
            <Link href="/">Submit</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/workers">Workers</Link>
          </nav>
          <main className="mx-auto max-w-5xl p-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
