import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognitive Substrate | Cognitive Workbench",
  description: "End-user interface for distributed cognitive infrastructure",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
