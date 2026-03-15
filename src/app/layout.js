import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Aether Particles",
  description: "Experience de particules 3D controlee par les mains avec Three.js et MediaPipe.",
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
