import { z } from "zod";

export const revisionFieldsSchema = z
  .object({
    text: z.string().trim().min(1, "Add the question wording."),
    category: z.enum(["fun", "deep", "memories", "relationship", "friendship"]),
    relationshipFit: z.enum(["both", "partner", "friend"]),
    modeFit: z.enum(["both", "together", "private"]),
    intensity: z.enum(["light", "medium", "deep"]),
  })
  .superRefine((value, context) => {
    if (value.category === "relationship" && value.relationshipFit !== "partner") {
      context.addIssue({
        code: "custom",
        path: ["relationshipFit"],
        message: "Relationship questions are for partners.",
      });
    }
    if (value.category === "friendship" && value.relationshipFit !== "friend") {
      context.addIssue({
        code: "custom",
        path: ["relationshipFit"],
        message: "Friendship questions are for friends.",
      });
    }
  });

export type RevisionFieldsForm = z.infer<typeof revisionFieldsSchema>;
