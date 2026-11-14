import type { Metadata } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

// Stand-in for Valio Aimo's proprietary heavy condensed heading face.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin", "latin-ext"],
  weight: ["700", "800"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Aimo Planner",
  description: "Turn one sentence into a priced Valio Aimo order draft.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${barlowCondensed.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
