import type { Metadata, Viewport } from "next";
import { env } from "cloudflare:workers";
import { safeMetadataBase } from "./tracker-config";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5efe3",
};

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = safeMetadataBase(env.SITE_URL);
  const socialImage = new URL("/og-road-to-desert-v3.png", metadataBase);

  return {
    metadataBase,
    title: "Road to the Desert · Coachella 2027",
    description: "A private road to Coachella 2027.",
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      title: "Road to the Desert",
      description: "A private road to Coachella 2027.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Road to the Desert · Coachella 2027" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Road to the Desert",
      description: "A private road to Coachella 2027.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
