import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name so your person knows who joined.")
  .max(40, "Names can be up to 40 characters.");

export const onboardingSchema = z.object({
  displayName: displayNameSchema,
});

export const createPairSchema = z.object({
  relationshipType: z.enum(["partner", "friend"]),
});

export const joinPairSchema = z.object({ displayName: displayNameSchema });

export const privateAnswerSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a little something before saving.")
    .max(2000, "Answers can be up to 2,000 characters."),
});

export const privateReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a short thought before saving.")
    .max(500, "Replies can be up to 500 characters."),
});

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Passwords must be at least 8 characters."),
});

export const signUpSchema = z.object({
  name: z.string().min(2, "Names must be at least 2 characters."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Passwords must be at least 8 characters."),
});

export type CreatePairValues = z.infer<typeof createPairSchema>;
export type OnboardingValues = z.infer<typeof onboardingSchema>;
export type JoinPairValues = z.infer<typeof joinPairSchema>;
export type PrivateAnswerValues = z.infer<typeof privateAnswerSchema>;
export type PrivateReplyValues = z.infer<typeof privateReplySchema>;
export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
