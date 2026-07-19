import { handleApiRoute } from "@/lib/api/response";
import { sendPushToPeople } from "@/lib/push";
import { requireViewer } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";

/**
 * Send a test notification to yourself.
 *
 * The only way to confirm the whole chain works on a real device — especially
 * on iOS, where a missing Add-to-Home-Screen step fails silently.
 */
export const POST = handleApiRoute(async () => {
  const viewer = await requireViewer();

  const result = await sendPushToPeople([viewer.id], {
    title: "Tiffine",
    body: "Notifications are working. You'll get a nudge when the menu is published.",
    url: "/",
    tag: "test",
  });

  if (result.sent === 0) {
    throw new AppError(
      "NOT_FOUND",
      "No active subscription on this device. Turn notifications on first.",
    );
  }

  return { sent: result.sent };
});
