import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { saveMenuSchema } from "@/lib/schemas/menu";
import { saveMenuDay } from "@/lib/services/menu-service";
import { requireViewer } from "@/lib/auth/session";
import { instantFromLocal } from "@/lib/time";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(saveMenuSchema, await readJson(request));

  // The client sends a wall-clock time; the instant is derived here so the
  // browser's timezone can never decide when ordering closes.
  const deadlineAt = instantFromLocal(input.dateKey, input.deadlineTime);

  const result = await saveMenuDay(viewer, {
    dateKey: input.dateKey,
    title: input.title,
    deadlineAt,
    items: input.items,
  });

  return { menuDayId: result.menuDayId };
});
