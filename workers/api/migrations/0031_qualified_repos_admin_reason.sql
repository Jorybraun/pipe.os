-- Add admin_reason to qualified_repos for human annotation (training data)
ALTER TABLE qualified_repos ADD COLUMN admin_reason TEXT;
