import { AppSidebar } from "@/components/AppSidebar";

export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar credits={72} />
      <main className="main-content" style={{ display: "flex", flexDirection: "column" }}>{children}</main>
    </div>
  );
}
