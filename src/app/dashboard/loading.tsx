export default function DashboardLoading() {
  return (
    <div className="page-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", gap: "16px" }}>
      <div className="spinner"></div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading dashboard...</p>
    </div>
  );
}
