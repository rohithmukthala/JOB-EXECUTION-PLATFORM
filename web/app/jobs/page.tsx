"use client";
import Link from "next/link";
import { useJobs } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

export default function JobsPage() {
  const { data: jobs = [] } = useJobs();
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Jobs</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Type</th><th>Priority</th><th>Status</th>
            <th>Progress</th><th>Attempts</th><th>Worker</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b hover:bg-white">
              <td className="py-2"><Link className="text-blue-600 underline" href={`/jobs/${j.id}`}>{j.type}</Link></td>
              <td>{j.priority}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="w-40">
                <div className="h-2 w-full rounded bg-gray-200">
                  <div className="h-2 rounded bg-blue-500" style={{ width: `${j.progress}%` }} />
                </div>
              </td>
              <td>{j.attempts}/{j.maxAttempts}</td>
              <td className="font-mono text-xs">{j.workerId?.slice(0, 8) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
