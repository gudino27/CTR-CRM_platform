// teamId matches visitTeams[].id
// weekStartDate is always the Monday of the visit week (local date, no UTC offset)
// scheduleIndex refers to the index in team.schedule[]
export const rotations = [
  { id: "r1",  teamId: "t1", scheduleIndex: 0, assignedVolunteerId: "v1",  weekStartDate: "2026-01-26", status: "completed" },
  { id: "r2",  teamId: "t1", scheduleIndex: 0, assignedVolunteerId: "v3",  weekStartDate: "2026-02-02", status: "completed" },
  { id: "r3",  teamId: "t1", scheduleIndex: 0, assignedVolunteerId: "v1",  weekStartDate: "2026-02-09", status: "completed" },
  { id: "r4",  teamId: "t1", scheduleIndex: 0, assignedVolunteerId: "v3",  weekStartDate: "2026-02-16", status: "scheduled" },
  { id: "r5",  teamId: "t1", scheduleIndex: 0, assignedVolunteerId: "v1",  weekStartDate: "2026-02-23", status: "scheduled" },
  { id: "r6",  teamId: "t2", scheduleIndex: 0, assignedVolunteerId: "v9",  weekStartDate: "2026-02-09", status: "completed" },
  { id: "r7",  teamId: "t2", scheduleIndex: 0, assignedVolunteerId: "v9",  weekStartDate: "2026-02-16", status: "scheduled" },
  { id: "r8",  teamId: "t3", scheduleIndex: 0, assignedVolunteerId: "v2",  weekStartDate: "2026-01-26", status: "completed" },
  { id: "r9",  teamId: "t3", scheduleIndex: 0, assignedVolunteerId: "v7",  weekStartDate: "2026-02-02", status: "completed" },
  { id: "r10", teamId: "t3", scheduleIndex: 0, assignedVolunteerId: "v2",  weekStartDate: "2026-02-16", status: "scheduled" },
  { id: "r11", teamId: "t4", scheduleIndex: 0, assignedVolunteerId: "v8",  weekStartDate: "2026-02-09", status: "completed" },
  { id: "r12", teamId: "t4", scheduleIndex: 0, assignedVolunteerId: "v8",  weekStartDate: "2026-02-16", status: "scheduled" },
  // t6 schedule is Saturday (dayOfWeek 6) — weekStartDate is the Monday of that week
  { id: "r13", teamId: "t6", scheduleIndex: 0, assignedVolunteerId: "v4",  weekStartDate: "2026-02-02", status: "completed" },
  { id: "r14", teamId: "t6", scheduleIndex: 0, assignedVolunteerId: "v10", weekStartDate: "2026-02-09", status: "completed" },
  { id: "r15", teamId: "t6", scheduleIndex: 0, assignedVolunteerId: "v4",  weekStartDate: "2026-02-16", status: "scheduled" },
  { id: "r16", teamId: "t7", scheduleIndex: 0, assignedVolunteerId: "v5",  weekStartDate: "2026-02-16", status: "scheduled" },
  // t1 Thursday visits (scheduleIndex: 1)
  { id: "r17", teamId: "t1", scheduleIndex: 1, assignedVolunteerId: "v3",  weekStartDate: "2026-02-02", status: "completed" },
  { id: "r18", teamId: "t1", scheduleIndex: 1, assignedVolunteerId: "v1",  weekStartDate: "2026-02-09", status: "completed" },
  { id: "r19", teamId: "t1", scheduleIndex: 1, assignedVolunteerId: "v3",  weekStartDate: "2026-02-16", status: "scheduled" },
  // t3 Friday visits (scheduleIndex: 1)
  { id: "r20", teamId: "t3", scheduleIndex: 1, assignedVolunteerId: "v7",  weekStartDate: "2026-02-02", status: "completed" },
  { id: "r21", teamId: "t3", scheduleIndex: 1, assignedVolunteerId: "v2",  weekStartDate: "2026-02-16", status: "scheduled" },
];
