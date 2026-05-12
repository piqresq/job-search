-- Move salary-floor logic out of the hardcoded scoring contract and into the
-- editable per-user scoring policy stored in `app_settings`.
--
-- Migration 0024 seeded `openai_scoring_policy_instruction` without a salary
-- floor section (the floor logic still lived in the hardcoded contract at that
-- point). After 0024 the contract was made truly generic, so the salary floor
-- now needs to live in the editable policy or it will silently disappear.
--
-- This migration appends the salary section to the stored policy ONLY when:
--   1) a row exists for that key, AND
--   2) the current value does NOT already contain "Salary preferences"
--      (idempotent; preserves any user customization that already added one).

UPDATE app_settings
SET value = TRIM(value) || char(10) || char(10) ||
'Salary preferences (full-time only, EUR/month equivalent):
- Net floor: {{NET_MONTHLY_MIN_EUR}} EUR/month net.
- Gross floor: {{GROSS_MONTHLY_MIN_EUR}} EUR/month gross.
- Apply salary-based rejection only to clearly full-time roles where salary_found is true.
- If the role is full-time and the stated lower bound is clearly below the appropriate floor in the same net/gross sense, set recommendation to reject and rejection_reason to one short line about pay being below the candidate''s minimum.
- Conversion when comparing: monthly compares directly; annual lower bound / 12; hourly assumes 40 h/week (~167 monthly hours) unless the posting clearly states a different full-time week.
- If salary_tax_hint is unknown, treat the figure as gross for this comparison.
- If the role is part-time, freelance/contract, or full-time status is unclear, do not apply salary-based rejection (still extract salary_* per the contract).'
WHERE key = 'openai_scoring_policy_instruction'
  AND value NOT LIKE '%Salary preferences%';
