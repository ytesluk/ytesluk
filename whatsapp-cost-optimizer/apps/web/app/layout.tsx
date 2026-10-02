import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WCO — WhatsApp Cost Optimizer", template: "%s · WCO" },
  description: "Camada de otimização de custo entre sistemas empresariais e a WhatsApp Business Platform Cloud API.",
};

// Applies the saved theme before first paint (no flash). Values: "light" | "dark" | absent (= system).
const themeScript = `try{var t=localStorage.getItem("wco-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
