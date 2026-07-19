import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { lockDaySchema } from "@/lib/schemas/day";
import { lockDayAsAdmin } from "@/lib/services/day-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(lockDaySchema, await readJson(request));

  await lockDayAsAdmin(viewer, input.dateKey);
  return { locked: true };
});
