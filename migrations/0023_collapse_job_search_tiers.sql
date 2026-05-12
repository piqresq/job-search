-- Keep historical job metadata aligned with the single-tier search model.
-- Existing jobs can have normalized_json.searchTier = 2 from the old planner.

UPDATE jobs
SET normalized_json = json_set(normalized_json, '$.searchTier', 1)
WHERE json_valid(normalized_json)
  AND CAST(json_extract(normalized_json, '$.searchTier') AS INTEGER) = 2;
