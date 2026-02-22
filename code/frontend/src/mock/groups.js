// Each entry is one senior's virtual visit team.
// One senior per team — no group names, no descriptions.
// All visits are virtual.
// schedule is an array so seniors can have multiple visit days per week.
export const visitTeams = [
  {
    id: "t1",
    seniorId: "s1",
    volunteerIds: ["v1", "v3"],
    schedule: [
      { dayOfWeek: 1, timeOfDay: "10:00" },
      { dayOfWeek: 4, timeOfDay: "14:00" },
    ],
    isActive: true,
  },
  {
    id: "t2",
    seniorId: "s3",
    volunteerIds: ["v9"],
    schedule: [{ dayOfWeek: 3, timeOfDay: "13:00" }],
    isActive: true,
  },
  {
    id: "t3",
    seniorId: "s2",
    volunteerIds: ["v2", "v7"],
    schedule: [
      { dayOfWeek: 2, timeOfDay: "09:30" },
      { dayOfWeek: 5, timeOfDay: "11:00" },
    ],
    isActive: true,
  },
  {
    id: "t4",
    seniorId: "s5",
    volunteerIds: ["v8"],
    schedule: [{ dayOfWeek: 4, timeOfDay: "10:00" }],
    isActive: true,
  },
  {
    id: "t5",
    seniorId: "s8",
    volunteerIds: ["v7"],
    schedule: [{ dayOfWeek: 1, timeOfDay: "09:00" }],
    isActive: true,
  },
  {
    id: "t6",
    seniorId: "s4",
    volunteerIds: ["v4", "v10"],
    schedule: [{ dayOfWeek: 6, timeOfDay: "11:00" }],
    isActive: true,
  },
  {
    id: "t7",
    seniorId: "s7",
    volunteerIds: ["v5"],
    schedule: [{ dayOfWeek: 2, timeOfDay: "14:30" }],
    isActive: true,
  },
];
