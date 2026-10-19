import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Practice Ready | TSM",
  description: "Book an MPR and check equipment readiness before practice.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
