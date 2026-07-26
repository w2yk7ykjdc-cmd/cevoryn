import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { iyzicoRequest } from "@/lib/iyzico/client";
import { getIyzicoConfig } from "@/lib/iyzico/config";

export interface IyzicoAddress {
  address: string;
  zipCode: string;
  contactName: string;
  city: string;
  country: string;
}

export interface IyzicoSubscriptionCustomer {
  name: string;
  surname: string;
  email: string;
  gsmNumber: string;
  identityNumber: string;
  billingAddress: IyzicoAddress;
  shippingAddress: IyzicoAddress;
}

interface InitializeSubscriptionResponse {
  status: "success";
  conversationId?: string;
  token: string;
  checkoutFormContent: string;
  tokenExpireTime?: number;
}

interface RetrieveSubscriptionResponse {
  status: "success";
  token: string;
  data: {
    referenceCode: string;
    parentReferenceCode?: string;
    pricingPlanReferenceCode: string;
    customerReferenceCode: string;
    subscriptionStatus: "ACTIVE" | "PENDING" | "UNPAID" | "UPGRADED" | "CANCELED" | "EXPIRED";
    trialDays?: number;
    trialStartDate?: number;
    trialEndDate?: number;
    createdDate?: number;
    startDate?: number;
    endDate?: number;
  };
}

export function initializeIyzicoSubscription(input: {
  callbackUrl: string;
  pricingPlanReferenceCode: string;
  conversationId: string;
  customer: IyzicoSubscriptionCustomer;
}): Promise<InitializeSubscriptionResponse> {
  return iyzicoRequest<InitializeSubscriptionResponse>(
    "/v2/subscription/checkoutform/initialize",
    {
      body: {
        locale: "tr",
        callbackUrl: input.callbackUrl,
        pricingPlanReferenceCode: input.pricingPlanReferenceCode,
        subscriptionInitialStatus: "ACTIVE",
        conversationId: input.conversationId,
        customer: input.customer,
      },
    }
  );
}

export function retrieveIyzicoSubscription(
  token: string,
  conversationId?: string
): Promise<RetrieveSubscriptionResponse> {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";
  return iyzicoRequest<RetrieveSubscriptionResponse>(
    `/v2/subscription/checkoutform/${encodeURIComponent(token)}${query}`,
    { method: "GET" }
  );
}

export interface IyzicoSubscriptionWebhookPayload {
  merchantId: string | number;
  iyziEventType: "subscription.order.success" | "subscription.order.failure";
  subscriptionReferenceCode: string;
  orderReferenceCode: string;
  customerReferenceCode: string;
  iyziReferenceCode: string;
  iyziEventTime: number;
}

export function verifyIyzicoSubscriptionWebhook(
  payload: IyzicoSubscriptionWebhookPayload,
  receivedSignature: string
): boolean {
  const { secretKey } = getIyzicoConfig();
  const message =
    String(payload.merchantId) +
    secretKey +
    payload.iyziEventType +
    payload.subscriptionReferenceCode +
    payload.orderReferenceCode +
    payload.customerReferenceCode;
  const expected = createHmac("sha256", secretKey).update(message).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(receivedSignature.trim().toLowerCase(), "utf8");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
