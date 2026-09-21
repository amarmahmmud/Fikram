import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://fikram.live";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/settings", "/api", "/new-job", "/jobs", "/credits"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
