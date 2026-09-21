import { POST } from "@/app/api/webhooks/modal/route";
import { NextRequest } from "next/server";

// Mock Supabase admin client to ensure it is never called when unauthenticated
const mockSelect = jest.fn();
const mockFrom = jest.fn(() => ({
  select: mockSelect,
}));

jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: jest.fn(() => ({
    from: mockFrom,
  })),
}));

import { createAdminClient } from "@/lib/supabase/admin";

describe("Modal Webhook Authentication (/api/webhooks/modal)", () => {
  const ORIGINAL_ENV = process.env;
  const TEST_SECRET = "test_modal_webhook_secret_998877665544332211";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, MODAL_WEBHOOK_SECRET: TEST_SECRET };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("fails closed (rejects with 401) if MODAL_WEBHOOK_SECRET is not configured in environment", async () => {
    delete process.env.MODAL_WEBHOOK_SECRET;

    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "some_random_secret",
      },
      body: JSON.stringify({ job_id: "test-job-id" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Webhook authentication unconfigured");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects with 401 when auth header is missing completely", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job_id: "test-job-id", status: "completed" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects with 401 when x-webhook-secret is incorrect", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "invalid_secret_token",
      },
      body: JSON.stringify({ job_id: "test-job-id", status: "completed" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects with 401 when Authorization: Bearer is incorrect", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer wrong_bearer_token",
      },
      body: JSON.stringify({ job_id: "test-job-id", status: "completed" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("confirms database and refund logic is unreachable without a valid secret", async () => {
    // Attempt exploit payload attempting to refund credits
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": "attacker_guessed_secret",
      },
      body: JSON.stringify({
        job_id: "victim-job-uuid",
        status: "completed",
        adapter_prefix: "malicious_prefix",
        actual_credits: 0, // trying to trigger 100% refund
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("passes authentication with valid x-webhook-secret and reaches request validation", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": TEST_SECRET,
      },
      body: JSON.stringify({}), // Empty body: should pass auth and fail with missing job_id
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing job_id");
  });

  it("passes authentication with valid Authorization: Bearer header and reaches request validation", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/modal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${TEST_SECRET}`,
      },
      body: JSON.stringify({}), // Empty body: should pass auth and fail with missing job_id
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing job_id");
  });
});
