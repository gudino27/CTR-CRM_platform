import { openDb } from './index.js';

const platforms = [
  { key: 'facebook',  name: 'Facebook',  days: ['MON', 'WED', 'FRI'], times: ['10:00'], color: '9', limit: 63206,
    usesColors: true, types: ['Reminder', 'Quote / Article', 'Student Quote'] },
  { key: 'instagram', name: 'Instagram', days: ['TUE', 'THU'],        times: ['11:00'], color: '3', limit: 2200,
    usesColors: true, types: ['Conversation Starter', 'Student Quote', 'Mission Post'] },
  { key: 'linkedin',  name: 'LinkedIn',  days: ['TUE', 'THU'],        times: ['12:00'], color: '7', limit: 3000,
    usesColors: false, types: ['Newsletter', 'Article', 'About Us'] },
  { key: 'test',      name: 'Test',      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], times: ['12:00'], color: '8', limit: 5000, isTest: true,
    usesColors: true, types: ['Type A', 'Type B', 'Type C'] },
];

export function seed(db) {
  const insert = db.prepare(`
    INSERT INTO platform (key, name, isTest, postingDays, postingTimes, calendarColorId, charLimit, sortOrder, usesColors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO NOTHING`);
  platforms.forEach((p, i) =>
    insert.run(p.key, p.name, p.isTest ? 1 : 0, JSON.stringify(p.days), JSON.stringify(p.times), p.color, p.limit, i, p.usesColors ? 1 : 0));

  // Post types and colors are seeded once per platform, so a database from before them gets them too
  const platformByKey = db.prepare('SELECT id FROM platform WHERE key = ?');
  const hasTypes = db.prepare('SELECT 1 FROM postType WHERE platformId = ?');
  const setColors = db.prepare('UPDATE platform SET usesColors = ? WHERE id = ?');
  const insertType = db.prepare('INSERT INTO postType (platformId, name, sortOrder) VALUES (?, ?, ?)');
  for (const p of platforms) {
    const { id } = platformByKey.get(p.key);
    if (hasTypes.get(id)) continue;
    setColors.run(p.usesColors ? 1 : 0, id);
    p.types.forEach((name, i) => insertType.run(id, name, i));
  }

  // Holiday posts carry their own type but only as Specific Date posts, so it stays out of the rotation
  const hasHoliday = db.prepare("SELECT 1 FROM postType WHERE platformId = ? AND name = 'Holiday'");
  const insertHoliday = db.prepare("INSERT INTO postType (platformId, name, sortOrder, inRotation) VALUES (?, 'Holiday', 99, 0)");
  for (const p of platforms) {
    const { id } = platformByKey.get(p.key);
    if (!hasHoliday.get(id)) insertHoliday.run(id);
  }

  // Library posts from before post types existed get the platform's first type, and Blue where colors apply
  db.exec(`
    UPDATE post SET
      postTypeId = (SELECT id FROM postType WHERE platformId = post.platformId AND inRotation = 1 ORDER BY sortOrder, id LIMIT 1),
      color = CASE WHEN (SELECT usesColors FROM platform WHERE id = post.platformId) THEN 'Blue' END
    WHERE kind = 'library' AND postTypeId IS NULL`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  seed(db);
  console.log('Seeded platforms:', db.prepare('SELECT name FROM platform').all().map((r) => r.name).join(', '));
}
