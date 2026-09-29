import { openDb } from './index.js';

const platforms = [
  { key: 'facebook',  name: 'Facebook',  days: ['MON', 'WED', 'FRI'], times: ['10:00'], color: '9', limit: 63206 },
  { key: 'instagram', name: 'Instagram', days: ['TUE', 'THU'],        times: ['11:00'], color: '3', limit: 2200 },
  { key: 'linkedin',  name: 'LinkedIn',  days: ['TUE', 'THU'],        times: ['12:00'], color: '7', limit: 3000 },
  { key: 'test',      name: 'Test',      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], times: ['12:00'], color: '8', limit: 5000, isTest: true },
];

export function seed(db) {
  const insert = db.prepare(`
    INSERT INTO platform (key, name, isTest, postingDays, postingTimes, calendarColorId, charLimit, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO NOTHING`);
  platforms.forEach((p, i) =>
    insert.run(p.key, p.name, p.isTest ? 1 : 0, JSON.stringify(p.days), JSON.stringify(p.times), p.color, p.limit, i));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  seed(db);
  console.log('Seeded platforms:', db.prepare('SELECT name FROM platform').all().map((r) => r.name).join(', '));
}
