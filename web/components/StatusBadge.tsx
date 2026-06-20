const COLORS: Record<string, string> = {
  pending: "bg-gray-200 text-gray-800",
  running: "bg-blue-200 text-blue-900",
  succeeded: "bg-green-200 text-green-900",
  failed: "bg-amber-200 text-amber-900",
  dead: "bg-red-200 text-red-900",
  active: "bg-green-200 text-green-900",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COLORS[status] ?? "bg-gray-200"}`}>{status}</span>;
}
