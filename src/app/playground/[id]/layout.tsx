import { AppSidebar } from "@/components/AppSidebar";

export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main-content" style={{ display: "flex", flexDirection: "column" }}>{children}</main>
    </div>
  );
}
