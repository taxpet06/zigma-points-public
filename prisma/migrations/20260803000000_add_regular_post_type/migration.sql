-- AlterEnum
-- REGULAR: a plain social post (title + optional description + optional images). It reuses
-- the Post table with its unused columns neutralised at creation — zpAmount 0, no PostTarget
-- rows, settled true so the settlement cron's `settled: false` filter skips it — rather than
-- making those columns nullable, which would force a null check at every existing read site.
ALTER TYPE "PostType" ADD VALUE 'REGULAR';
