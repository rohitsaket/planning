-- Country and lab authorization scope.
--
-- Additive and backward compatible: the table starts empty, and an empty scope for a
-- dimension means unrestricted, so every existing account keeps exactly the access it
-- had. Narrowing someone's access is an explicit insert by an authorized administrator.
--
-- The value is a column, not an element of a delimited string, so it can be indexed,
-- uniquely constrained, revoked individually and audited on its own.

CREATE TABLE "UserAccessScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccessScope_pkey" PRIMARY KEY ("id")
);

-- One grant per user, per dimension, per value: re-granting is idempotent rather than
-- creating a duplicate that a later revocation would miss.
CREATE UNIQUE INDEX "UserAccessScope_userId_dimension_value_key"
    ON "UserAccessScope"("userId", "dimension", "value");

-- Matches the read every request performs: the whole scope for one user.
CREATE INDEX "UserAccessScope_userId_dimension_idx"
    ON "UserAccessScope"("userId", "dimension");

ALTER TABLE "UserAccessScope"
    ADD CONSTRAINT "UserAccessScope_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
