import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { paymentStatusSchema } from "@/lib/schemas/settlement";
import { setPaymentStatus } from "@/lib/services/settlement-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(paymentStatusSchema, await readJson(request));

  await setPaymentStatus(viewer, input);
  return { updated: true };
});
