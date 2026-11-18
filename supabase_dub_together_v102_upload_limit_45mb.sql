-- Dub Together v102: raise the private clip/media bucket limit to 45 MiB.
-- Run once in the Supabase SQL Editor after supabase_dub_together_setup.sql.
-- 45 MiB = 45 * 1024 * 1024 = 47,185,920 bytes.

update storage.buckets
set file_size_limit = 47185920
where id = 'dub-media';

-- Verification: this should return dub-media with file_size_limit = 47185920.
select
  id,
  name,
  file_size_limit,
  round(file_size_limit / 1048576.0, 1) as max_size_mib
from storage.buckets
where id = 'dub-media';
