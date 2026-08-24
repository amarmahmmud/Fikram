import { AppSidebar } from "@/components/AppSidebar";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
