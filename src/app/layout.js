import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "aether",
  description: "Sculpture particulaire reactive au geste avec Three.js et MediaPipe.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr" style={{ backgroundColor: "#02050a" }}>
      <head>
        <style>{`
          html, body {
            margin: 0;
            min-height: 100%;
            background: #02050a;
            color: #ffffff;
          }
        `}</style>
      </head>
      <body style={{ margin: 0, backgroundColor: "#02050a", color: "#ffffff" }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
