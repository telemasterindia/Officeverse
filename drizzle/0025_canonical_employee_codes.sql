-- Canonical Employee ID format — BUSINESS RULE CORRECTION.
--
--   Agent  → TMI_CC_###      Closer → TMI_CL_###
--
-- ONE-TIME, NON-RENUMBERING conversion of LEGACY codes only:
--   * a code already in canonical form (`TMI_CC_###` / `TMI_CL_###`) is NEVER
--     touched — an assigned employee code is a permanent identity;
--   * each remaining legacy code (`AG-#####`, `CL-#####`, `TMI_CC###`, …) is
--     given the NEXT AVAILABLE number = (current MAX canonical suffix in that
--     namespace) + (its position, by `id`, among the legacy rows);
--   * therefore this statement is idempotent — re-running it, or running it on a
--     database that is already fully canonical (e.g. tmi_officeverse_dryrun,
--     converted by the first cut of this migration), changes nothing.
--
-- NO `ROW_NUMBER()` over the whole table and NO blanket renumber: existing
-- employees keep their code across migration, joining/leaving, deactivation,
-- promotion, reseeding and row-order changes.
--
-- SAFE for relationships: no foreign key references a `*_code` string
-- (`leads.agent_id`, `leads.assigned_closer_id`, `lead_assignments.*_closer_id`
-- all reference the numeric `id` PK). `audit_logs` is never rewritten.
UPDATE `agents` AS `a`
JOIN (
  SELECT `l`.`id`,
         (SELECT COALESCE(MAX(CAST(SUBSTRING(`k`.`agent_code`, 8) AS UNSIGNED)), 0)
            FROM `agents` `k`
           WHERE `k`.`agent_code` REGEXP '^TMI_CC_[0-9]+$')
         + (SELECT COUNT(*)
              FROM `agents` `p`
             WHERE `p`.`agent_code` NOT REGEXP '^TMI_CC_[0-9]+$'
               AND `p`.`id` <= `l`.`id`) AS `newnum`
    FROM `agents` `l`
   WHERE `l`.`agent_code` NOT REGEXP '^TMI_CC_[0-9]+$'
) AS `seq` ON `seq`.`id` = `a`.`id`
SET `a`.`agent_code` = CONCAT('TMI_CC_', LPAD(`seq`.`newnum`, 3, '0'));
--> statement-breakpoint
UPDATE `closers` AS `c`
JOIN (
  SELECT `l`.`id`,
         (SELECT COALESCE(MAX(CAST(SUBSTRING(`k`.`closer_code`, 8) AS UNSIGNED)), 0)
            FROM `closers` `k`
           WHERE `k`.`closer_code` REGEXP '^TMI_CL_[0-9]+$')
         + (SELECT COUNT(*)
              FROM `closers` `p`
             WHERE `p`.`closer_code` NOT REGEXP '^TMI_CL_[0-9]+$'
               AND `p`.`id` <= `l`.`id`) AS `newnum`
    FROM `closers` `l`
   WHERE `l`.`closer_code` NOT REGEXP '^TMI_CL_[0-9]+$'
) AS `seq` ON `seq`.`id` = `c`.`id`
SET `c`.`closer_code` = CONCAT('TMI_CL_', LPAD(`seq`.`newnum`, 3, '0'));
