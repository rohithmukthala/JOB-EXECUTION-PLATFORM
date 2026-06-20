import { useQuery } from "@tanstack/react-query";
import { fetchJob, fetchJobs, fetchWorkers } from "./api";

const POLL = 1500;
export const useJobs = (status?: string) =>
  useQuery({ queryKey: ["jobs", status], queryFn: () => fetchJobs(status), refetchInterval: POLL });
export const useJob = (id: string) =>
  useQuery({ queryKey: ["job", id], queryFn: () => fetchJob(id), refetchInterval: POLL });
export const useWorkers = () =>
  useQuery({ queryKey: ["workers"], queryFn: fetchWorkers, refetchInterval: POLL });
