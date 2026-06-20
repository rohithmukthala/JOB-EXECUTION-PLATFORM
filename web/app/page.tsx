"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createJob } from "@/lib/api";

export default function SubmitPage() {
  const qc = useQueryClient();
  const [type, setType] = useState("simulate");
  const [priority, setPriority] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [payload, setPayload] = useState('{ "steps": 8, "stepMs": 500, "failRate": 0 }');
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let parsed: unknown = {};
    try { parsed = JSON.parse(payload || "{}"); }
    catch { setMsg("Invalid JSON payload"); return; }
    const job = await createJob({ type, payload: parsed, priority, maxAttempts });
    setMsg(`Created job ${job.id}`);
    qc.invalidateQueries({ queryKey: ["jobs"] });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-bold">Submit a job</h1>
      <label className="block">Type
        <input className="mt-1 w-full rounded border p-2" value={type} onChange={(e) => setType(e.target.value)} />
      </label>
      <div className="flex gap-4">
        <label className="block flex-1">Priority
          <input type="number" className="mt-1 w-full rounded border p-2" value={priority} onChange={(e) => setPriority(+e.target.value)} />
        </label>
        <label className="block flex-1">Max attempts
          <input type="number" className="mt-1 w-full rounded border p-2" value={maxAttempts} onChange={(e) => setMaxAttempts(+e.target.value)} />
        </label>
      </div>
      <label className="block">Payload (JSON)
        <textarea className="mt-1 h-32 w-full rounded border p-2 font-mono text-sm" value={payload} onChange={(e) => setPayload(e.target.value)} />
      </label>
      <button className="rounded bg-blue-600 px-4 py-2 font-medium text-white">Submit</button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </form>
  );
}
