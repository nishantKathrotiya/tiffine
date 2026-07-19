import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { pushSubscriptionSchema } from "@/lib/schemas/push";
import { saveSubscription } from "@/lib/push";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(pushSubscriptionSchema, await readJson(request));

  await saveSubscription(
    viewer.id,
    input.subscription,
    request.headers.get("user-agent") ?? undefined,
  );

  return { subscribed: true };
});
