"use client";
import { useJob } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const { data: job } = useJob(params.id);
  if (!job) return <p>Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{job.type}</h1>
        <StatusBadge status={job.status} />
      </div>
      <p className="text-sm text-gray-600">
        attempts {job.attempts}/{job.maxAttempts} · progress {job.progress}%
        {job.error && <span className="ml-2 text-red-600">error: {job.error}</span>}
      </p>
      <h2 className="font-semibold">History</h2>
      <ol className="space-y-1 border-l-2 pl-4">
        {job.events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="font-mono text-xs text-gray-400">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
            <span className="font-semibold">{e.type}</span>
            {e.message && <span className="text-gray-600"> — {e.message}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
