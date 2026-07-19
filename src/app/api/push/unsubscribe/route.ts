import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { unsubscribeSchema } from "@/lib/schemas/push";
import { deactivateSubscription } from "@/lib/push";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  await requireViewer();
  const input = parseOrThrow(unsubscribeSchema, await readJson(request));

  // Deactivated server-side only. The client must not call
  // subscription.unsubscribe() — Safari then refuses to re-subscribe without a
  // fresh user gesture, silently cutting the person off.
  await deactivateSubscription(input.endpoint);
  return { unsubscribed: true };
});
