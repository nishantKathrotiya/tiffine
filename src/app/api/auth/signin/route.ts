import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { signInSchema } from "@/lib/schemas/auth";
import { signIn } from "@/lib/services/auth-service";

export const POST = handleApiRoute(async (request) => {
  const input = parseOrThrow(signInSchema, await readJson(request));
  const result = await signIn(input);

  return { personId: result.personId, accountStatus: result.accountStatus };
});
