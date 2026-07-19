import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { decideCancellationSchema } from "@/lib/schemas/day";
import { decideCancellation } from "@/lib/services/cancellation-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(decideCancellationSchema, await readJson(request));

  await decideCancellation(viewer, input);
  return {
    decided: true,
    message: input.approve
      ? "Cancelled — they won't get a tiffin and won't be billed."
      : "Declined — the tiffin is being delivered, so they'll be billed.",
  };
});
