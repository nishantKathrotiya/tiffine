import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { providerBillSchema } from "@/lib/schemas/settlement";
import { setProviderBill } from "@/lib/services/settlement-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(providerBillSchema, await readJson(request));

  await setProviderBill(viewer, input);
  return { saved: true };
});
