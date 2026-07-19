import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { setAccountStatusSchema } from "@/lib/schemas/people";
import { setAccountStatus } from "@/lib/services/people-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  // Authorization is re-checked inside the service; a hidden button is not a
  // control and this endpoint is reachable directly.
  const viewer = await requireViewer();
  const input = parseOrThrow(setAccountStatusSchema, await readJson(request));

  await setAccountStatus(viewer, input.personId, input.status);
  return { updated: true };
});
