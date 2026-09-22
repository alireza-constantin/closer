import { z } from "zod";

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(1, "Choose a display name.").max(40),
});
export const pairSchema = z.object({
  intendedPersonName: z.string().trim().min(1, "Add the person’s name.").max(40),
  relationshipType: z.enum(["partner", "friend"]),
});
export type DisplayNameForm = z.infer<typeof displayNameSchema>;
export type PairForm = z.infer<typeof pairSchema>;
