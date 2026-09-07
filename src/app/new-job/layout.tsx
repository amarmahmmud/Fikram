import { Suspense } from "react";
import { AppSidebar } from "@/components/AppSidebar";

export default function NewJobLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main-content">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
