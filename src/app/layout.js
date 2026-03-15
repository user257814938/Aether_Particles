import "./globals.css";

export const metadata = {
  title: "Aether Particles",
  description: "Experience de particules 3D controlee par les mains avec Three.js et MediaPipe.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
