import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SentinelQA",
  description: "No-code browser testing and monitoring"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
