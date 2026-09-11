import type { MetadataRoute } from "next";

// Web App Manifest — drives Android "Add to Home Screen" (and desktop PWA install).
// Android masks the icon to the device shape, so the icons are full-bleed red with
// the ZP mark inside the 80% safe zone (purpose "any maskable"). This keeps the
// installed icon identical to the app icon (src/app/icon.svg / favicon).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zigma Points",
    short_name: "Zigma Points",
    description: "Community-driven points and recognition platform",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
