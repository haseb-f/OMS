import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError, isGenericForbiddenMessage } from "./api-client";
import { messages } from "@/i18n/messages";
import { defaultLocale } from "@/i18n/locales";

/**
 * FIX-QA OBS1 — a 403 that carries a deliberately-authored explanation must
 * reach the user; only the framework/guard defaults fall back to the
 * generic localized "no permission" text.
 */
const CORRECTION_MESSAGE =
  "Fulfillment has started or a payment is already posted for this order — changing the payment declaration now is a correction that requires the store-orders.manage or sales.receipts.confirm permission.";

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

async function captureError(): Promise<ApiError> {
  try {
    await apiClient.post("/store-orders/x/payment-declarations", {});
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("api-client 403 messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the server's explanatory 403 message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockResponse(403, { code: "PERMISSION_ERROR", message: CORRECTION_MESSAGE });
    const error = await captureError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe(CORRECTION_MESSAGE);
  });

  it.each([
    ["Forbidden resource"],
    ["Forbidden"],
    ['Missing permission "store-orders.edit".'],
    [""],
  ])("keeps the generic localized text for the default message %j", async (raw) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockResponse(403, { code: "PERMISSION_ERROR", message: raw });
    const error = await captureError();
    expect(error.message).toBe(messages[defaultLocale].errors.PERMISSION_ERROR);
  });

  it("classifies generic vs explanatory messages", () => {
    expect(isGenericForbiddenMessage(undefined)).toBe(true);
    expect(isGenericForbiddenMessage("Forbidden resource")).toBe(true);
    expect(isGenericForbiddenMessage('No permission is registered for "x.y".')).toBe(true);
    expect(isGenericForbiddenMessage(CORRECTION_MESSAGE)).toBe(false);
    expect(isGenericForbiddenMessage("ليس لديك صلاحية لعرض هذا الإيصال")).toBe(false);
  });
});
