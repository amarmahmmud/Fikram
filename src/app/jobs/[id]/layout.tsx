import { AppSidebar } from "@/components/AppSidebar";

export default function JobDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar credits={72} />
      <main className="main-content">{children}</main>
    </div>
  );
}
