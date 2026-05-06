import type { FastifyReply, FastifyRequest } from "fastify";
import { hashApiToken, prisma } from "@sentinelqa/db";

export interface Principal {
  userId: string | null;
  organizationId: string;
  tokenId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const rawToken = auth.slice("Bearer ".length).trim();
    const tokenHash = hashApiToken(rawToken);
    const token = await prisma.apiToken.findUnique({ where: { tokenHash } });
    if (token) {
      await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
      request.principal = {
        userId: token.userId,
        organizationId: token.organizationId,
        tokenId: token.id
      };
      return;
    }
  }

  const sessionUserId = request.cookies.sq_session;
  if (sessionUserId) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: sessionUserId },
      orderBy: { createdAt: "asc" }
    });
    if (membership) {
      request.principal = {
        userId: sessionUserId,
        organizationId: membership.organizationId
      };
      return;
    }
  }

  reply.status(401).send({ error: "unauthorized" });
}

export async function getDevUser() {
  const user = await prisma.user.findUnique({ where: { email: "dev@sentinelqa.local" } });
  if (user) {
    return user;
  }
  return prisma.user.create({
    data: {
      email: "dev@sentinelqa.local",
      name: "SentinelQA Dev"
    }
  });
}

