import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "aether",
  description: "Sculpture particulaire reactive au geste avec Three.js et MediaPipe.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
