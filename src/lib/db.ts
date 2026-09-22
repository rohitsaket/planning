import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // Query logging is a development aid only; production logs stay free of SQL.
    log: process.env.NODE_ENV === 'development' && process.env.PRISMA_LOG_QUERIES === 'true' ? ['query'] : ['warn', 'error'],
  });
}

function getPrismaClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && 'demandMetricTraceItem' in cached) {
    return cached;
  }
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const db = getPrismaClient();
