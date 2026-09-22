import { requestJson } from "@/lib/api-client";

export type AdminActor = { authUserId: string; kind: "admin" | "registered" | "anonymous" };
export type AdminSession = { actor: AdminActor | null };

export type RevisionFields = {
  text: string;
  category: Category;
  relationshipFit: RelationshipFit;
  modeFit: ModeFit;
  intensity: Intensity;
};

export type Revision = RevisionFields & {
  id: string;
  questionId: string;
  revisionNumber: number;
  withdrawn: boolean;
};

export type Question = {
  id: string;
  currentRevisionId: string;
  isActive: boolean;
  current: Revision;
};

export type DuplicateMatch = {
  questionId: string;
  text: string;
  revisionNumber: number;
  isActive: boolean;
};

export type Category = "fun" | "deep" | "memories" | "relationship" | "friendship";
export type RelationshipFit = "both" | "partner" | "friend";
export type ModeFit = "both" | "together" | "private";
export type Intensity = "light" | "medium" | "deep";

export type QuestionFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: Category | "";
  intensity?: Intensity | "";
  relationshipFit?: RelationshipFit | "";
  modeFit?: ModeFit | "";
};

export type QuestionList = { items: Question[]; page: number; pageSize: number };
export type QuestionDetail = { question: Question; revisions: Revision[] };

const categoryValues = new Set<Category>(["fun", "deep", "memories", "relationship", "friendship"]);
const relationshipValues = new Set<RelationshipFit>(["both", "partner", "friend"]);
const modeValues = new Set<ModeFit>(["both", "together", "private"]);
const intensityValues = new Set<Intensity>(["light", "medium", "deep"]);

function read(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (value[key] !== undefined) return value[key];
  return undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function booleanValue(value: unknown) {
  return value === true;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const candidate = stringValue(value) as T;
  return allowed.has(candidate) ? candidate : fallback;
}

function normalizeRevision(value: unknown): Revision {
  const item = object(value);
  return {
    id: stringValue(read(item, "id", "ID")),
    questionId: stringValue(read(item, "questionId", "QuestionID")),
    text: stringValue(read(item, "text", "Text")),
    category: enumValue(read(item, "category", "Category"), categoryValues, "fun"),
    relationshipFit: enumValue(
      read(item, "relationshipFit", "RelationshipFit"),
      relationshipValues,
      "both",
    ),
    modeFit: enumValue(read(item, "modeFit", "ModeFit"), modeValues, "both"),
    intensity: enumValue(read(item, "intensity", "Intensity"), intensityValues, "medium"),
    revisionNumber: numberValue(read(item, "revisionNumber", "RevisionNumber")),
    withdrawn: booleanValue(read(item, "withdrawn", "Withdrawn")),
  };
}

function normalizeQuestion(value: unknown): Question {
  const item = object(value);
  const current = normalizeRevision(read(item, "current", "Current"));
  return {
    id: stringValue(read(item, "id", "ID")),
    currentRevisionId: stringValue(read(item, "currentRevisionId", "CurrentRevisionID")),
    isActive: booleanValue(read(item, "isActive", "IsActive")),
    current: { ...current, questionId: current.questionId || stringValue(read(item, "id", "ID")) },
  };
}

function normalizeDuplicate(value: unknown): DuplicateMatch {
  const item = object(value);
  return {
    questionId: stringValue(read(item, "questionId", "QuestionID")),
    text: stringValue(read(item, "text", "Text")),
    revisionNumber: numberValue(read(item, "revisionNumber", "RevisionNumber")),
    isActive: booleanValue(read(item, "isActive", "IsActive")),
  };
}

function projectSession(value: unknown): AdminSession {
  const actor = read(object(value), "actor", "Actor");
  if (!actor) return { actor: null };
  const item = object(actor);
  const kind = stringValue(read(item, "kind", "Kind"));
  return {
    actor: {
      authUserId: stringValue(read(item, "authUserId", "AuthUserID")),
      kind: kind === "admin" || kind === "registered" || kind === "anonymous" ? kind : "anonymous",
    },
  };
}

export const adminSessionKey = ["admin", "session"] as const;

export async function getAdminSession(): Promise<AdminSession> {
  return projectSession(await requestJson("me"));
}

export async function adminLogin(email: string, password: string): Promise<AdminSession> {
  return projectSession(
    await requestJson("admin/login", { method: "POST", body: { email, password } }),
  );
}

export async function adminLogout() {
  await requestJson("admin/logout", { method: "POST" });
}

export async function listQuestions(filters: QuestionFilters = {}): Promise<QuestionList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 25,
    ...filters,
  })) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = object(await requestJson(`admin/questions/?${params.toString()}`));
  return {
    items: Array.isArray(response.items) ? response.items.map(normalizeQuestion) : [],
    page: numberValue(response.page) || 1,
    pageSize: numberValue(response.pageSize) || 25,
  };
}

export async function getQuestion(questionId: string): Promise<QuestionDetail> {
  const response = object(await requestJson(`admin/questions/${encodeURIComponent(questionId)}`));
  return {
    question: normalizeQuestion(response.question),
    revisions: Array.isArray(response.revisions) ? response.revisions.map(normalizeRevision) : [],
  };
}

export async function findDuplicates(
  text: string,
  excludeQuestionId?: string,
): Promise<DuplicateMatch[]> {
  const params = new URLSearchParams({ text });
  if (excludeQuestionId) params.set("excludeQuestionId", excludeQuestionId);
  const response = object(await requestJson(`admin/questions/duplicates?${params.toString()}`));
  return Array.isArray(response.matches) ? response.matches.map(normalizeDuplicate) : [];
}

export async function createQuestion(fields: RevisionFields): Promise<Question> {
  const response = object(await requestJson("admin/questions/", { method: "POST", body: fields }));
  return normalizeQuestion(response.question);
}

export async function editQuestion(
  questionId: string,
  fields: RevisionFields,
  expectedCurrentRevisionId: string,
): Promise<Question> {
  const response = object(
    await requestJson(`admin/questions/${encodeURIComponent(questionId)}/revisions`, {
      method: "POST",
      body: { ...fields, expectedCurrentRevisionId },
    }),
  );
  return normalizeQuestion(response.question);
}

export async function restoreRevision(
  questionId: string,
  revisionId: string,
  expectedCurrentRevisionId: string,
): Promise<Question> {
  const response = object(
    await requestJson(
      `admin/questions/${encodeURIComponent(questionId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: "POST", body: { expectedCurrentRevisionId } },
    ),
  );
  return normalizeQuestion(response.question);
}

export async function setQuestionActivity(
  questionId: string,
  action: "activate" | "reactivate" | "deactivate",
) {
  const response = object(
    await requestJson(`admin/questions/${encodeURIComponent(questionId)}/${action}`, {
      method: "POST",
      body: {},
    }),
  );
  return normalizeQuestion(response.question);
}

export async function withdrawRevision(
  questionId: string,
  revisionId: string,
  reason: string,
): Promise<Revision> {
  const response = await requestJson(
    `admin/questions/${encodeURIComponent(questionId)}/revisions/${encodeURIComponent(revisionId)}/withdraw`,
    { method: "POST", body: { reason } },
  );
  return normalizeRevision(response);
}
