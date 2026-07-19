import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { placeOrderSchema } from "@/lib/schemas/order";
import { placeOrder } from "@/lib/services/order-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(placeOrderSchema, await readJson(request));

  // placeOrder re-checks approval status, the deadline, and that every item
  // belongs to the open round. None of that is inferred from the UI.
  const result = await placeOrder(viewer, input);

  return {
    orderId: result.orderId,
    totalPaise: result.totalPaise,
    message: result.orderId ? "Order saved." : "Order cleared — you're not down for today.",
  };
});
