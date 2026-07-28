import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "暴躁肉团子", description: "吞噬街道、成长并摧毁整座城市的 Web 游戏原型。" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN"><body>{children}</body></html>; }
