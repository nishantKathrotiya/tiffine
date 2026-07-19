import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { markSentSchema } from "@/lib/schemas/day";
import { markSentToProvider } from "@/lib/services/day-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(markSentSchema, await readJson(request));

  await markSentToProvider(viewer, input.dateKey);
  return { sent: true };
});
