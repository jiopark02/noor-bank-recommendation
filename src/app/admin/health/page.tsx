"use client";

// ============================================================================
// STEP 4 — Admin monitoring page: /admin/health
// ============================================================================
// File: src/app/admin/health/page.tsx (new file)
//
// READ-ONLY cron monitoring dashboard. Shows recent cron_runs so an admin can
// see whether the summarize / extract-facts crons are running and healthy.
//
// Security model (defense lives in the API, not here):
//   - Data comes from GET /api/admin/cron-runs, which is gated by requireAdmin.
//   - A non-admin (or logged-out) caller gets 403 / 401 from that API, so this
//     page simply shows an "access denied / sign in" message. The page being
//     reachable is fine; the API is the real boundary.
//   - This page performs NO writes. Fixes happen in Supabase / code.
//
// "Cron-down" inference: if a job's most recent run is older than a threshold,
// we flag it — a silent failure (cron not firing) won't create rows, so an old
// last-run time is the signal.
// ============================================================================

import { useEffect, useState } from "react";
import { PageLayout } from "@/components/layout";
import { buildBearerOnlyHeaders } from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders } from "@/lib/supabase-browser";
import { asPlainObject, readErrorMessage } from "@/lib/requestJson";

// Shape of a cron_runs row as returned by the API.
interface CronRun {
  id: string;
  job_name: string;
  status: "success" | "partial" | "failed";
  started_at: string;
  finished_at: string;
  duration_ms: number | null;
  items_processed: number;
  items_failed: number;
  stats: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

// Jobs we expect to be running, and how stale a last-run may be before we warn.
// summarize runs hourly at :00, extract-facts hourly at :30. We allow a wide
// margin (3h) so a single missed/late run does not cause false alarms.
const EXPECTED_JOBS = ["summarize", "extract-facts"] as const;
const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

type AccessState = "loading" | "ok" | "forbidden" | "signin" | "error";

function statusColor(status: CronRun["status"]): string {
  switch (status) {
    case "success":
      return "bg-green-100 text-green-800";
    case "partial":
      return "bg-yellow-100 text-yellow-800";
    case "failed":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function AdminHealthPage() {
  const [access, setAccess] = useState<AccessState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const authHeaders = await getSupabaseBearerHeaders();
        // No token at all → ask the user to sign in.
        if (!authHeaders.Authorization) {
          if (isMounted) setAccess("signin");
          return;
        }

        const res = await fetch("/api/admin/cron-runs", {
          headers: buildBearerOnlyHeaders(authHeaders),
        });

        if (res.status === 401) {
          if (isMounted) setAccess("signin");
          return;
        }
        if (res.status === 403) {
          if (isMounted) setAccess("forbidden");
          return;
        }
        if (!res.ok) {
          const body = asPlainObject(await res.json().catch(() => ({})));
          if (isMounted) {
            setErrorMessage(readErrorMessage(body) || "Failed to load cron runs");
            setAccess("error");
          }
          return;
        }

        const data = asPlainObject(await res.json());
        const list = Array.isArray(data.runs) ? (data.runs as CronRun[]) : [];
        if (isMounted) {
          setRuns(list);
          setAccess("ok");
        }
      } catch (err) {
        console.error("AdminHealthPage: load failed:", err);
        if (isMounted) {
          setErrorMessage("Failed to load cron runs");
          setAccess("error");
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // For each expected job, find its most recent run and whether it looks stale.
  const jobHealth = EXPECTED_JOBS.map((job) => {
    const latest = runs.find((r) => r.job_name === job); // runs are newest-first
    const lastRunMs = latest ? new Date(latest.finished_at).getTime() : null;
    const isStale =
      lastRunMs === null || Date.now() - lastRunMs > STALE_THRESHOLD_MS;
    return { job, latest, isStale };
  });

  return (
    <PageLayout>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">System Health</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cron monitoring — read-only. Fixes are made in Supabase or code.
        </p>
      </div>

      {access === "loading" && (
        <p className="text-sm text-gray-500">Loading…</p>
      )}

      {access === "signin" && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          You need to sign in to view this page.
        </div>
      )}

      {access === "forbidden" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Access denied. This page is restricted to administrators.
        </div>
      )}

      {access === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage || "Something went wrong."}
        </div>
      )}

      {access === "ok" && (
        <div className="space-y-8">
          {/* Per-job health summary (cron-down inference). */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Jobs
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {jobHealth.map(({ job, latest, isStale }) => (
                <div
                  key={job}
                  className={`rounded-lg border p-4 ${
                    isStale
                      ? "border-red-200 bg-red-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{job}</span>
                    {isStale ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        no recent run
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(
                          latest!.status
                        )}`}
                      >
                        {latest!.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {latest
                      ? `Last run: ${formatTime(latest.finished_at)}`
                      : "No runs recorded yet."}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Recent runs table. */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Recent runs
            </h2>
            {runs.length === 0 ? (
              <p className="text-sm text-gray-500">No runs recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Job</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Finished</th>
                      <th className="px-3 py-2 font-medium">Duration</th>
                      <th className="px-3 py-2 font-medium">Processed</th>
                      <th className="px-3 py-2 font-medium">Failed</th>
                      <th className="px-3 py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                          {run.job_name}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(
                              run.status
                            )}`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                          {formatTime(run.finished_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                          {formatDuration(run.duration_ms)}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {run.items_processed}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {run.items_failed > 0 ? (
                            <span className="font-medium text-red-700">
                              {run.items_failed}
                            </span>
                          ) : (
                            run.items_failed
                          )}
                        </td>
                        <td className="max-w-xs truncate px-3 py-2 text-gray-500" title={run.error || ""}>
                          {run.error || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </PageLayout>
  );
}
