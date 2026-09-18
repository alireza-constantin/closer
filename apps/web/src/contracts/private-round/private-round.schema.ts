import { z } from "zod";

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

export type PrivateAnswerValues = z.infer<typeof privateAnswerSchema>;
export type PrivateReplyValues = z.infer<typeof privateReplySchema>;
