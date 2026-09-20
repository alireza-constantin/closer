import { createAuthClient } from "better-auth/react";

export const adminAuthClient = createAuthClient({ basePath: "/api/admin-auth" });
