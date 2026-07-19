import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { publishMenuSchema } from "@/lib/schemas/menu";
import { publishMenuDay } from "@/lib/services/menu-service";
import { requireViewer } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(publishMenuSchema, await readJson(request));

  await publishMenuDay(viewer, input.dateKey);

  // The link Deep pastes into the WhatsApp group — the app doesn't replace
  // WhatsApp, it just gives the group something to tap.
  const shareUrl = `${publicEnv.NEXT_PUBLIC_APP_URL}/d/${input.dateKey}`;

  return { published: true, shareUrl };
});
