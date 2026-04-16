-- Add admin_status column to qualified_repos for human-in-the-loop approval
-- Values: 'pending' (default) | 'approved' | 'denied'
ALTER TABLE qualified_repos ADD COLUMN admin_status TEXT NOT NULL DEFAULT 'pending';
