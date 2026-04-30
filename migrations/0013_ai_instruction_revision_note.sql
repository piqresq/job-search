-- Optional user note per AI prompt revision (dashboard).
ALTER TABLE ai_instruction_revisions ADD COLUMN note TEXT NOT NULL DEFAULT '';
