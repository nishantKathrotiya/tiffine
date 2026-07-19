import { handleApiRoute } from "@/lib/api/response";
import { destroySession } from "@/lib/auth/session";

export const POST = handleApiRoute(async () => {
  await destroySession();
  return { signedOut: true };
});
