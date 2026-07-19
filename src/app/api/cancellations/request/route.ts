import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { requestCancellationSchema } from "@/lib/schemas/day";
import { requestCancellation } from "@/lib/services/cancellation-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(requestCancellationSchema, await readJson(request));

  const result = await requestCancellation(viewer, input);
  return {
    requestId: result.requestId,
    message: "Cancellation requested. An admin will approve or decline it.",
  };
});
