import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { mergePeopleSchema } from "@/lib/schemas/people";
import { mergePeople } from "@/lib/services/people-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(mergePeopleSchema, await readJson(request));

  const result = await mergePeople(viewer, input.sourceId, input.targetId);
  return {
    ordersMoved: result.ordersMoved,
    message: `Merged. ${result.ordersMoved} order(s) moved to the kept account.`,
  };
});
