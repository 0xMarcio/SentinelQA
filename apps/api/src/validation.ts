import type { FastifyReply } from "fastify";
import type { z } from "zod";

export function parseOrReply<T extends z.ZodTypeAny>(schema: T, value: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    reply.status(400).send({
      error: "validation_error",
      issues: parsed.error.issues
    });
    return undefined;
  }
  return parsed.data;
}

export const idParams = <K extends string>(key: K) =>
  ((value: unknown) => value) as unknown as z.ZodObject<Record<K, z.ZodString>>;

