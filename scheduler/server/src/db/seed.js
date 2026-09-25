// Seeds the launch platforms. Posting days/times are placeholders 
import { openDb } from './index.js';

const platforms = [
  { name: 'Facebook',  days: ['MON', 'WED', 'FRI'], times: ['10:00'], color: '9', limit: 63206 },
  { name: 'Instagram', days: ['TUE', 'THU'],        times: ['11:00'], color: '3', limit: 2200 },
  { name: 'LinkedIn',  days: ['TUE', 'THU'],        times: ['09:00'], color: '7', limit: 3000 },
  { name: 'Test',      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], times: ['12:00'], color: '8', limit: 5000, isTest: true },
];

export function seed(db) {
  const insert = db.prepare(`
    INSERT INTO platform (name, is_test, posting_days, posting_times, calendar_color_id, char_limit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (name) DO NOTHING`);
  platforms.forEach((p, i) =>
    insert.run(p.name, p.isTest ? 1 : 0, JSON.stringify(p.days), JSON.stringify(p.times), p.color, p.limit, i));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  seed(db);
  console.log('Seeded platforms:', db.prepare('SELECT name FROM platform').all().map((r) => r.name).join(', '));
}
