ALTER TABLE "settings" ADD COLUMN "memberRoleIds" JSONB NOT NULL DEFAULT '[]';

UPDATE "settings"
SET "memberRoleIds" = jsonb_build_array("memberRoleId")
WHERE "memberRoleId" IS NOT NULL
  AND "memberRoleIds" = '[]'::jsonb;
