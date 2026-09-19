import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging is a development aid only; production logs stay free of SQL.
    log: process.env.NODE_ENV === 'development' && process.env.PRISMA_LOG_QUERIES === 'true' ? ['query'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
