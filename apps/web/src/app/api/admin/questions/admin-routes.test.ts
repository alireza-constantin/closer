import { beforeEach, describe, expect, mock, test } from "bun:test";

class TestAdminAuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super("Admin access denied.");
  }
}

class TestCloserDomainError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

let authorization: "admin" | "anonymous" | "consumer" = "admin";
const listAdminQuestions = mock(async () => ({ items: [], page: 1, pageSize: 25, total: 0 }));
const createCatalogQuestion = mock(async () => ({
  question: {
    id: "00000000-0000-4000-8000-000000000001",
    currentRevisionId: "00000000-0000-4000-8000-000000000002",
    isActive: false,
  },
  revision: { id: "00000000-0000-4000-8000-000000000002", revisionNumber: 1 },
}));
const createCatalogRevision = mock(async () => {
  throw new TestCloserDomainError("QUESTION_REVISION_CONFLICT");
});
const listAdminQuestionRevisions = mock(async () => ({
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
}));

mock.module("@Closer/db/closer", () => ({ CloserDomainError: TestCloserDomainError }));
mock.module("server-only", () => ({}));
mock.module("@/server/auth/admin", () => ({
  AdminAuthorizationError: TestAdminAuthorizationError,
  requireAdmin: async () => {
    if (authorization === "anonymous") throw new TestAdminAuthorizationError(401);
    if (authorization === "consumer") throw new TestAdminAuthorizationError(403);
    return { user: { id: "admin-test-user" } };
  },
}));
mock.module("@/server/http/admin-origin", () => ({
  hasTrustedAdminMutationOrigin: (request: Request) =>
    !["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) ||
    request.headers.get("origin") === "https://closer.test",
}));
mock.module("@/server/modules/admin-questions/admin-question.service", () => ({
  listAdminQuestions,
  createCatalogQuestion,
  createCatalogRevision,
  listAdminQuestionRevisions,
}));

const questionsRoute = await import("./route");
const revisionsRoute = await import("./[questionId]/revisions/route");

describe("Admin catalog API routes", () => {
  beforeEach(() => {
    authorization = "admin";
    listAdminQuestions.mockClear();
    createCatalogQuestion.mockClear();
    createCatalogRevision.mockClear();
    listAdminQuestionRevisions.mockClear();
  });

  test("enforces Admin authorization for each endpoint", async () => {
    authorization = "anonymous";
    const response = await questionsRoute.GET(
      new Request("https://closer.test/api/admin/questions"),
    );

    expect(response.status).toBe(401);
    expect(listAdminQuestions).not.toHaveBeenCalled();

    authorization = "consumer";
    const consumerResponse = await revisionsRoute.GET(
      new Request("https://closer.test/api/admin/questions/q/revisions"),
      { params: Promise.resolve({ questionId: "00000000-0000-4000-8000-000000000001" }) },
    );
    expect(consumerResponse.status).toBe(403);
  });

  test("parses and forwards catalog filters and pagination", async () => {
    listAdminQuestions.mockResolvedValueOnce({ items: [], page: 2, pageSize: 50, total: 0 });
    const response = await questionsRoute.GET(
      new Request(
        "https://closer.test/api/admin/questions?page=2&pageSize=50&activity=inactive&category=deep&intensity=deep&modeFit=private&revisionHealth=withdrawn",
      ),
    );

    expect(response.status).toBe(200);
    expect(listAdminQuestions).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 50,
        activity: "inactive",
        category: "deep",
        intensity: "deep",
        modeFit: "private",
        revisionHealth: "withdrawn",
      },
      { user: { id: "admin-test-user" } },
    );
  });

  test("rejects untrusted mutation origins and malformed revision fields", async () => {
    const untrusted = await questionsRoute.POST(
      new Request("https://closer.test/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.test" },
        body: JSON.stringify({}),
      }),
    );
    expect(untrusted.status).toBe(403);
    expect(createCatalogQuestion).not.toHaveBeenCalled();

    const invalid = await questionsRoute.POST(
      new Request("https://closer.test/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://closer.test" },
        body: JSON.stringify({
          text: "Question",
          category: "relationship",
          relationshipFit: "friend",
          modeFit: "both",
          intensity: "light",
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(createCatalogQuestion).not.toHaveBeenCalled();
  });

  test("maps a stale revision write to HTTP 409", async () => {
    const response = await revisionsRoute.POST(
      new Request(
        "https://closer.test/api/admin/questions/00000000-0000-4000-8000-000000000001/revisions",
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://closer.test" },
          body: JSON.stringify({
            text: "Revised wording",
            category: "deep",
            relationshipFit: "both",
            modeFit: "private",
            intensity: "medium",
            expectedCurrentRevisionId: "00000000-0000-4000-8000-000000000002",
          }),
        },
      ),
      { params: Promise.resolve({ questionId: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "QUESTION_REVISION_CONFLICT" });
    expect(createCatalogRevision).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "00000000-0000-4000-8000-000000000001" }),
      "admin-test-user",
    );
  });
});
