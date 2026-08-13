import { AppSidebar } from "@/components/AppSidebar";
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar credits={72} />
      <main className="main-content">{children}</main>
    </div>
  );
}
