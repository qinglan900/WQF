import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智能客服",
  description: "基于 Coze 工作流的订单查询与物流跟踪客服 Demo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full min-h-full bg-[var(--color-bg)] font-[var(--font-body)] text-[var(--color-fg)]">
        {children}
      </body>
    </html>
  );
}
