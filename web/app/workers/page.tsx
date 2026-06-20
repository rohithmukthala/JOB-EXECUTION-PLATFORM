"use client";
import { useWorkers } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

function secondsAgo(iso: string) { return Math.round((Date.now() - new Date(iso).getTime()) / 1000); }

export default function WorkersPage() {
  const { data: workers = [] } = useWorkers();
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Workers</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {workers.map((w) => {
          const ago = secondsAgo(w.lastHeartbeatAt);
          return (
            <div key={w.id} className="rounded border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{w.name}</span>
                <StatusBadge status={w.status} />
              </div>
              <p className="mt-2 font-mono text-xs text-gray-500">{w.id.slice(0, 8)}</p>
              <p className={`mt-1 text-sm ${ago > 15 ? "text-red-600" : "text-gray-600"}`}>
                last heartbeat {ago}s ago
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
