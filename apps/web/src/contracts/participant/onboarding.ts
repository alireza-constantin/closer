import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name so your person knows who joined.")
  .max(40, "Names can be up to 40 characters.");

export const onboardingSchema = z.object({
  displayName: displayNameSchema,
});
export type OnboardingValues = z.infer<typeof onboardingSchema>;
