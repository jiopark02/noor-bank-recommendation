/**
 * A stand-in for the service-role Supabase client, for the household tests.
 * rpc answers per function name; from(table) records every builder call and
 * resolves to the next queued answer for that table. Nothing reaches a
 * database.
 */

export type Answer = { data: unknown; error: unknown };

export type QueryRecord = { table: string; ops: Array<[string, unknown[]]> };

export type FakeOptions = {
  rpc?: Record<string, Answer | "throw">;
  tables?: Record<string, Answer[]>;
};

const BUILDER_METHODS = ["select", "eq", "in", "gt", "order", "maybeSingle"];

export function makeFakeClient(options: FakeOptions = {}) {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const queries: QueryRecord[] = [];
  const queues: Record<string, Answer[]> = {};
  for (const [table, answers] of Object.entries(options.tables ?? {})) {
    queues[table] = answers.slice();
  }

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args]);
      const answer = options.rpc?.[fn];
      if (answer === "throw") {
        return Promise.reject(new Error("sentinel-rpc-throw-text"));
      }
      return Promise.resolve(
        answer ?? { data: null, error: { code: "PGRST202", message: "sentinel-missing-function" } }
      );
    },
    from(table: string) {
      const record: QueryRecord = { table, ops: [] };
      queries.push(record);
      const builder: Record<string, unknown> = {};
      for (const method of BUILDER_METHODS) {
        builder[method] = (...args: unknown[]) => {
          record.ops.push([method, args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => {
        const queue = queues[table] ?? [];
        const answer = queue.length > 0 ? (queue.shift() as Answer) : { data: null, error: null };
        return Promise.resolve(answer).then(resolve, reject);
      };
      return builder;
    },
  };

  return { client, rpcCalls, queries };
}
