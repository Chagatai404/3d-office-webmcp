import type { Metadata } from "next";
import { JetBrains_Mono, Manrope, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { MobileNotice } from "@/components/shell/mobile-notice";
import "./styles.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quorum — Agent-Native Decision Rooms",
  description: "A shared decision room for humans and their browser agents.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${manrope.variable} ${jetBrainsMono.variable}`}>
      <body>
        <MobileNotice />
        {children}
      </body>
    </html>
  );
}
