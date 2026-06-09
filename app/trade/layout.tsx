import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "$VZN Marketplace | Bitcoin Social Media",
  description:
    "Trade $VZN and explore the VZN marketplace on Bitcoin social media.",
  openGraph: {
    title: "$VZN Marketplace | Bitcoin Social Media",
    description:
      "Trade $VZN and explore the VZN marketplace on Bitcoin social media.",
    url: "https://VZN.gold/trade",
    siteName: "VZN.gold",
    type: "website",
    images: [
      {
        url: "https://fbx-public.s3.us-east-1.amazonaws.com/vzn-gold-bar.png",
        width: 1200,
        height: 630,
        alt: "$VZN marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "$VZN Marketplace | Bitcoin Social Media",
    description:
      "Trade $VZN and explore the VZN marketplace on Bitcoin social media.",
    images: [
      "https://fbx-public.s3.us-east-1.amazonaws.com/vzn-gold-bar.png",
    ],
  },
};

export default function TradeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

