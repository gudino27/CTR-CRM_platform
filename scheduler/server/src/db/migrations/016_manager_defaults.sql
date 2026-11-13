-- Manager defaults and the end of the Pause feature (services/permissions.js, services/sync.js).
-- Managers get every permission except managing users: every post, slot, schedule, platform,
-- post type, image and archive ability. Only rows still at their old default (0) change, so a
-- manager permission a super admin has already set on the Permissions page stays as it is.
-- manageUsers stays 0.
UPDATE rolePermission SET allowed = 1
  WHERE role = 'manager' AND allowed = 0
    AND permission IN ('deletePosts', 'editPlatforms', 'deleteMedia', 'archivePosts');

-- Pausing a platform is no longer a feature. The paused column stays (nothing is dropped), but
-- no platform stays paused; turning a platform off (enabled = 0) is unchanged.
UPDATE platform SET paused = 0 WHERE paused != 0;
