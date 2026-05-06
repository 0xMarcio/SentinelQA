ALTER TABLE "VisualBaseline" ADD COLUMN "viewportKey" TEXT;

UPDATE "VisualBaseline"
SET "viewportKey" = COALESCE(
  ("viewport"->>'width') || 'x' || ("viewport"->>'height'),
  '1920x1080'
);

ALTER TABLE "VisualBaseline" ALTER COLUMN "viewportKey" SET NOT NULL;
ALTER TABLE "VisualBaseline" ALTER COLUMN "viewportKey" SET DEFAULT '1920x1080';

DROP INDEX "VisualBaseline_testId_browser_environmentKey_regionKey_key";

CREATE UNIQUE INDEX "VisualBaseline_testId_browser_viewportKey_environmentKey_regionKey_key"
ON "VisualBaseline"("testId", "browser", "viewportKey", "environmentKey", "regionKey");
