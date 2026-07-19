import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { commitSettlementSchema } from "@/lib/schemas/settlement";
import { commitSettlement } from "@/lib/services/settlement-service";
import { requireViewer } from "@/lib/auth/session";
import { formatPaise } from "@/lib/money";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(commitSettlementSchema, await readJson(request));

  // Recomputed server-side from the database, never from a preview the client
  // echoes back — the amounts people are asked to pay must be current.
  const result = await commitSettlement(viewer, input);

  return {
    runId: result.runId,
    totalPaise: result.totalPaise,
    personCount: result.personCount,
    message: `Settlement committed — ${formatPaise(result.totalPaise)} across ${result.personCount} ${result.personCount === 1 ? "person" : "people"}.`,
  };
});
