import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMM Agent",
  description: "AI-ассистент для контент-плана и публикаций в Telegram",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
