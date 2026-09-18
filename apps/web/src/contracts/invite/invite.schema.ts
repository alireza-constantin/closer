import { z } from "zod";

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name so your person knows who joined.")
  .max(40, "Names can be up to 40 characters.");

export const joinPairSchema = z.object({ displayName: displayNameSchema });
export type JoinPairValues = z.infer<typeof joinPairSchema>;
