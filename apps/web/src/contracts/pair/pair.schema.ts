import { z } from "zod";

export const intendedPersonNameValueSchema = z
  .string()
  .trim()
  .min(1, "Enter a name so your person knows who joined.")
  .max(40, "Names can be up to 40 characters.");

export const intendedPersonNameSchema = z.object({
  intendedPersonName: intendedPersonNameValueSchema,
});

export const createPairSchema = z.object({
  intendedPersonName: intendedPersonNameValueSchema,
  relationshipType: z.enum(["partner", "friend"]),
});

export type CreatePairValues = z.infer<typeof createPairSchema>;
export type IntendedPersonNameValues = z.infer<typeof intendedPersonNameSchema>;
