import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { openRepollSchema } from "@/lib/schemas/day";
import { openRepoll } from "@/lib/services/day-service";
import { requireViewer } from "@/lib/auth/session";
import { instantFromLocal } from "@/lib/time";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(openRepollSchema, await readJson(request));

  // Wall-clock in IST, resolved server-side so the browser's timezone never
  // decides when the new round closes.
  const deadlineAt = instantFromLocal(input.dateKey, input.deadlineTime);

  const result = await openRepoll(viewer, {
    dateKey: input.dateKey,
    reason: input.reason,
    deadlineAt,
    keepItemIds: input.keepItemIds,
    newItems: input.newItems,
  });

  return {
    roundNumber: result.roundNumber,
    affectedPeople: result.affectedPeople,
    message:
      result.affectedPeople === 0
        ? "New round opened. Nobody's existing order was affected."
        : `New round opened. ${result.affectedPeople} ${result.affectedPeople === 1 ? "person needs" : "people need"} to choose again.`,
  };
});
