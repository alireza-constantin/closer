import { afterEach, describe, expect, test } from "bun:test";

import {
  adminLogin,
  createQuestion,
  editQuestion,
  findDuplicates,
  listQuestions,
  restoreRevision,
  withdrawRevision,
} from "@/features/admin/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Admin API contract", () => {
  test("logs in through the dedicated Admin endpoint and projects the actor", async () => {
    let input = "";
    let request: RequestInit | undefined;
    globalThis.fetch = (async (value, init) => {
      input = String(value);
      request = init;
      return Response.json({ actor: { authUserId: "admin-1", kind: "admin" } });
    }) as typeof fetch;

    await expect(adminLogin("admin@example.com", "secret")).resolves.toEqual({
      actor: { authUserId: "admin-1", kind: "admin" },
    });
    expect(input).toContain("/api/v1/admin/login");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      email: "admin@example.com",
      password: "secret",
    });
  });

  test("keeps catalog filters server-side and normalizes Go projections", async () => {
    let input = "";
    globalThis.fetch = (async (value) => {
      input = String(value);
      return Response.json({
        items: [
          {
            ID: "question-1",
            CurrentRevisionID: "revision-1",
            IsActive: false,
            Current: {
              ID: "revision-1",
              QuestionID: "question-1",
              Text: "What made you smile today?",
              Category: "fun",
              RelationshipFit: "both",
              ModeFit: "together",
              Intensity: "light",
              RevisionNumber: 1,
              Withdrawn: false,
            },
          },
        ],
        page: 1,
        pageSize: 25,
      });
    }) as typeof fetch;

    const result = await listQuestions({ search: "smile", category: "fun", page: 1 });
    expect(input).toContain("search=smile");
    expect(input).toContain("category=fun");
    expect(input).not.toContain("activity=");
    expect(result.items[0]?.current.text).toBe("What made you smile today?");
    expect(result.items[0]?.isActive).toBe(false);
  });

  test("duplicate warnings are a separate read and do not prevent create", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (value) => {
      requests.push(String(value));
      if (String(value).includes("duplicates")) {
        return Response.json({
          matches: [
            { QuestionID: "existing", Text: "Same wording", RevisionNumber: 2, IsActive: true },
          ],
        });
      }
      return Response.json(
        {
          question: {
            ID: "new-question",
            CurrentRevisionID: "new-revision",
            IsActive: false,
            Current: {
              ID: "new-revision",
              QuestionID: "new-question",
              Text: "Same wording",
              Category: "fun",
              RelationshipFit: "both",
              ModeFit: "both",
              Intensity: "light",
              RevisionNumber: 1,
              Withdrawn: false,
            },
          },
        },
        { status: 201 },
      );
    }) as typeof fetch;

    await expect(findDuplicates("Same wording")).resolves.toHaveLength(1);
    await expect(
      createQuestion({
        text: "Same wording",
        category: "fun",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "light",
      }),
    ).resolves.toMatchObject({ isActive: false });
    expect(requests).toHaveLength(2);
  });

  test("revision commands carry optimistic concurrency and required withdrawal reasons", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (value, init) => {
      requests.push({ url: String(value), body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({
        question: {
          ID: "question-1",
          CurrentRevisionID: "revision-2",
          IsActive: true,
          Current: {
            ID: "revision-2",
            QuestionID: "question-1",
            Text: "Updated",
            Category: "fun",
            RelationshipFit: "both",
            ModeFit: "both",
            Intensity: "medium",
            RevisionNumber: 2,
            Withdrawn: false,
          },
        },
      });
    }) as typeof fetch;

    await editQuestion(
      "question-1",
      {
        text: "Updated",
        category: "fun",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "medium",
      },
      "revision-1",
    );
    await restoreRevision("question-1", "revision-1", "revision-2");
    expect(requests[0]?.body).toMatchObject({ expectedCurrentRevisionId: "revision-1" });
    expect(requests[1]?.body).toMatchObject({ expectedCurrentRevisionId: "revision-2" });
    expect(requests[1]?.url).toContain("/revision-1/restore");

    globalThis.fetch = (async (_value, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ reason: "Safety review" });
      return Response.json({
        ID: "revision-1",
        QuestionID: "question-1",
        Text: "Updated",
        Category: "fun",
        RelationshipFit: "both",
        ModeFit: "both",
        Intensity: "medium",
        RevisionNumber: 1,
        Withdrawn: true,
      });
    }) as typeof fetch;
    await expect(
      withdrawRevision("question-1", "revision-1", "Safety review"),
    ).resolves.toMatchObject({
      withdrawn: true,
    });
  });
});
