// This POC demonstrates Google Calendar integration with rotation logic

const express = require('express');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// ===== DATA MANAGEMENT =====
const DATA_FILE = path.join(__dirname, 'data.json');
let data = { users: [], groups: [], skipWeeks: [], rotations: [] };

async function loadData() {
  try {
    const fileContent = await fs.readFile(DATA_FILE, 'utf8');
    data = JSON.parse(fileContent);
    console.log('Data loaded');
  } catch (error) {
    console.log('Starting fresh');
    await saveData();
  }
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ===== GOOGLE OAUTH SETUP =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ===== DATE UTILITIES =====
function getWeekStartDate(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

function addWeeks(dateString, numWeeks) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + (numWeeks * 7));
  const result = date.toISOString().split('T')[0];
  console.log(`addWeeks("${dateString}", ${numWeeks}) = "${result}"`);
  return result;
}

// ===== ROTATION ALGORITHM =====
function getNextRotationAssignment(groupId, targetWeekDate) {
  const group = data.groups.find(g => g.id === groupId);
  if (!group) throw new Error('Group not found');
  if (!group.members || group.members.length === 0) throw new Error('Group has no members');

  const sortedMembers = [...group.members].sort((a, b) => a.orderPosition - b.orderPosition);
  let currentIndex = group.currentIndex || 0;
  let attempts = 0;
  let assignedUserId = null;

  while (attempts < sortedMembers.length) {
    const candidate = sortedMembers[currentIndex % sortedMembers.length];
    const userId = candidate.userId;
    const hasSkip = data.skipWeeks.some(skip =>
      skip.userId === userId && skip.groupId === groupId && skip.weekStartDate === targetWeekDate
    );

    if (!hasSkip) {
      assignedUserId = userId;
      break;
    }
    currentIndex++;
    attempts++;
  }

  if (!assignedUserId) throw new Error('All users have skip weeks');
  group.currentIndex = (currentIndex + 1) % sortedMembers.length;
  return { userId: assignedUserId, weekStartDate: targetWeekDate };
}

// ===== GOOGLE CALENDAR INTEGRATION =====
async function createCalendarEvent(userId, groupId, weekStartDate) {
  const user = data.users.find(u => u.id === userId);
  const group = data.groups.find(g => g.id === groupId);
  if (!user || !user.googleTokens) throw new Error('User not authenticated');
  if (!group) throw new Error('Group not found');

  oauth2Client.setCredentials(user.googleTokens);

  if (Date.now() >= user.googleTokens.expiry_date) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    user.googleTokens = credentials;
    await saveData();
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const startTime = `${weekStartDate}T${group.schedule.timeOfDay}:00`;
  const endHour = (parseInt(group.schedule.timeOfDay.split(':')[0]) + 1).toString().padStart(2, '0');
  const endTime = `${weekStartDate}T${endHour}:00:00`;

  const event = {
    summary: `${group.name} - Your Turn This Week`,
    description: `${group.description}\n\nYou are scheduled for this week's rotation.\n\nWeek starting: ${weekStartDate}`,
    start: { dateTime: startTime, timeZone: 'America/Los_Angeles' },
    end: { dateTime: endTime, timeZone: 'America/Los_Angeles' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 60 }
      ]
    }
  };

  const response = await calendar.events.insert({ calendarId: 'primary', resource: event });
  console.log('Event created: ' + response.data.htmlLink);
  return response.data.id;
}

async function deleteCalendarEvent(userId, eventId) {
  const user = data.users.find(u => u.id === userId);
  if (!user || !user.googleTokens) throw new Error('User not authenticated');

  oauth2Client.setCredentials(user.googleTokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

// ===== EXPRESS APP & API ROUTES =====
const app = express();
app.use(express.json());

app.use('/calendar-rotation-poc', express.static(__dirname));

// Auth routes
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ],
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    let user = data.users.find(u => u.email === userInfo.data.email);
    if (!user) {
      user = {
        id: generateId('user'),
        email: userInfo.data.email,
        name: userInfo.data.name || userInfo.data.email,
        googleTokens: tokens
      };
      data.users.push(user);
    } else {
      user.googleTokens = tokens;
    }
    await saveData();

    res.send(`<html><body style="font-family:Arial;text-align:center;padding:50px">
      <h1>Connected Successfully!</h1><p>Welcome, ${user.name}</p>
      <p>User ID: ${user.id}</p>
      <a href="/" style="padding:10px 20px;background:#4285f4;color:white;text-decoration:none;border-radius:4px">Go to Dashboard</a>
    </body></html>`);
  } catch (error) {
    res.send(`<h1>Error: ${error.message}</h1><a href="/">Go back</a>`);
  }
});

// API routes
app.get('/api/data', (req, res) => res.json(data));

app.post('/api/groups', async (req, res) => {
  const { name, description, dayOfWeek, timeOfDay } = req.body;
  const group = {
    id: generateId('group'),
    name,
    description: description || '',
    members: [],
    schedule: { dayOfWeek: parseInt(dayOfWeek) || 1, timeOfDay: timeOfDay || '09:00' },
    currentIndex: 0,
    isActive: true
  };
  data.groups.push(group);
  await saveData();
  res.json({ success: true, group });
});

app.post('/api/groups/:groupId/members', async (req, res) => {
  const group = data.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.members.some(m => m.userId === req.body.userId)) {
    return res.status(400).json({ error: 'User already in group' });
  }
  group.members.push({ userId: req.body.userId, orderPosition: group.members.length });
  await saveData();
  res.json({ success: true, group });
});

app.post('/api/trigger/:groupId', async (req, res) => {
  try {
    const numWeeks = req.body.numWeeks || 1;
    const startDate = req.body.weekStartDate || getWeekStartDate();
    const createdRotations = [];

    for (let i = 0; i < numWeeks; i++) {
      const targetDate = addWeeks(startDate, i);
      const { userId } = getNextRotationAssignment(req.params.groupId, targetDate);
      const eventId = await createCalendarEvent(userId, req.params.groupId, targetDate);

      const rotation = {
        id: generateId('rotation'),
        groupId: req.params.groupId,
        assignedUserId: userId,
        weekStartDate: targetDate,
        calendarEventId: eventId,
        status: 'scheduled',
        createdAt: new Date().toISOString()
      };
      data.rotations.push(rotation);
      createdRotations.push(rotation);
    }

    await saveData();

    const group = data.groups.find(g => g.id === req.params.groupId);
    const message = numWeeks === 1
      ? `Assigned rotation for ${group.name} - week of ${startDate}`
      : `Scheduled ${numWeeks} weeks of rotations for ${group.name} starting ${startDate}`;
    res.json({ success: true, rotations: createdRotations, message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/skip', async (req, res) => {
  const { userId, groupId, weekStartDate, reason } = req.body;
  const existing = data.skipWeeks.find(s =>
    s.userId === userId && s.groupId === groupId && s.weekStartDate === weekStartDate
  );
  if (existing) return res.status(400).json({ error: 'Skip already exists' });

  const skip = { id: generateId('skip'), userId, groupId, weekStartDate, reason: reason || '', createdAt: new Date().toISOString() };
  data.skipWeeks.push(skip);
  await saveData();
  res.json({ success: true, skip });
});

app.post('/api/swap', async (req, res) => {
  try {
    const { groupId, weekStartDate, fromUserId, toUserId } = req.body;
    const rotation = data.rotations.find(r =>
      r.groupId === groupId && r.weekStartDate === weekStartDate && r.assignedUserId === fromUserId
    );
    if (!rotation) return res.status(404).json({ error: 'Rotation not found' });

    if (rotation.calendarEventId) await deleteCalendarEvent(fromUserId, rotation.calendarEventId);
    const newEventId = await createCalendarEvent(toUserId, groupId, weekStartDate);
    rotation.assignedUserId = toUserId;
    rotation.calendarEventId = newEventId;
    rotation.swappedAt = new Date().toISOString();
    await saveData();

    const toUser = data.users.find(u => u.id === toUserId);
    res.json({ success: true, rotation, message: `Swapped to ${toUser.name}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/rotations/:rotationId', async (req, res) => {
  try {
    const rotation = data.rotations.find(r => r.id === req.params.rotationId);
    if (!rotation) return res.status(404).json({ error: 'Rotation not found' });

    if (rotation.calendarEventId) {
      await deleteCalendarEvent(rotation.assignedUserId, rotation.calendarEventId);
    }

    data.rotations = data.rotations.filter(r => r.id !== req.params.rotationId);
    await saveData();

    res.json({ success: true, message: 'Rotation cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/groups/:groupId/members/:userId', async (req, res) => {
  try {
    const group = data.groups.find(g => g.id === req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    group.members = group.members.filter(m => m.userId !== req.params.userId);

    const futureRotations = data.rotations.filter(r =>
      r.groupId === req.params.groupId &&
      r.assignedUserId === req.params.userId &&
      new Date(r.weekStartDate) >= new Date()
    );

    for (const rotation of futureRotations) {
      if (rotation.calendarEventId) {
        try {
          await deleteCalendarEvent(req.params.userId, rotation.calendarEventId);
        } catch (error) {
          console.log('Failed to delete calendar event:', error.message);
        }
      }
    }

    data.rotations = data.rotations.filter(r =>
      !(r.groupId === req.params.groupId && r.assignedUserId === req.params.userId && new Date(r.weekStartDate) >= new Date())
    );

    await saveData();

    const user = data.users.find(u => u.id === req.params.userId);
    res.json({ success: true, message: `Removed ${user.name} from group and cancelled ${futureRotations.length} future rotations` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== FRONTEND HTML =====
app.get('/', (req, res) => {
  res.send(require('fs').readFileSync(path.join(__dirname, 'frontend.html'), 'utf8'));
});

// ===== START SERVER =====
loadData().then(() => {
  app.listen(process.env.PORT || 3000, () => {
    console.log('Server: http://localhost:' + (process.env.PORT || 3000));
    console.log('Next: Open URL -> Connect Google  -> Add Members -> Trigger!');
  });
});
