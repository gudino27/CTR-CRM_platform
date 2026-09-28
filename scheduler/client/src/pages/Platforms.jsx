// Deliverable 2: posting days, times, and calendar color per platform.
// TODO(Sprint 4): editable settings that trigger a projection recalculation.

import { useState } from "react";

const initialPlatforms = [
  {
    id: 1,
    name: "Facebook",
    postingDays: ["Monday", "Wednesday", "Friday"],
    postingTime: "12:00",
    calendarColor: "Blue",
  },
  {
    id: 2,
    name: "Instagram",
    postingDays: ["Tuesday", "Thursday"],
    postingTime: "10:00",
    calendarColor: "Purple",
  },
  {
    id: 3,
    name: "LinkedIn",
    postingDays: ["Monday", "Wednesday"],
    postingTime: "09:00",
    calendarColor: "Green",
  },
];

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const calendarColors = [
  "Blue",
  "Green",
  "Purple",
  "Red",
  "Yellow",
  "Orange",
];

export default function Platforms() {
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [savedMessage, setSavedMessage] = useState("");

  function updatePostingTime(id, postingTime) {
    setPlatforms((currentPlatforms) =>
      currentPlatforms.map((platform) =>
        platform.id === id
          ? {
              ...platform,
              postingTime,
            }
          : platform
      )
    );

    setSavedMessage("");
  }

  function updateCalendarColor(id, calendarColor) {
    setPlatforms((currentPlatforms) =>
      currentPlatforms.map((platform) =>
        platform.id === id
          ? {
              ...platform,
              calendarColor,
            }
          : platform
      )
    );

    setSavedMessage("");
  }

  function togglePostingDay(id, day) {
    setPlatforms((currentPlatforms) =>
      currentPlatforms.map((platform) => {
        if (platform.id !== id) {
          return platform;
        }

        const dayIsSelected = platform.postingDays.includes(day);

        return {
          ...platform,
          postingDays: dayIsSelected
            ? platform.postingDays.filter(
                (postingDay) => postingDay !== day
              )
            : [...platform.postingDays, day],
        };
      })
    );

    setSavedMessage("");
  }

  function handleSave() {
    console.log("Platform settings:", platforms);
    setSavedMessage("Platform settings saved.");
  }

  return (
    <section>
      <h1>Platforms</h1>

      <p>
        Configure posting schedules and calendar settings for each platform.
      </p>

      {platforms.map((platform) => (
        <div key={platform.id}>
          <h2>{platform.name}</h2>

          <div>
            <strong>Posting Days</strong>

            {days.map((day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={platform.postingDays.includes(day)}
                  onChange={() =>
                    togglePostingDay(platform.id, day)
                  }
                />

                {day}
              </label>
            ))}
          </div>

          <div>
            <label htmlFor={`postingTime-${platform.id}`}>
              Posting Time
            </label>

            <input
              id={`postingTime-${platform.id}`}
              type="time"
              value={platform.postingTime}
              onChange={(event) =>
                updatePostingTime(
                  platform.id,
                  event.target.value
                )
              }
            />
          </div>

          <div>
            <label htmlFor={`calendarColor-${platform.id}`}>
              Google Calendar Color
            </label>

            <select
              id={`calendarColor-${platform.id}`}
              value={platform.calendarColor}
              onChange={(event) =>
                updateCalendarColor(
                  platform.id,
                  event.target.value
                )
              }
            >
              {calendarColors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          </div>

          <hr />
        </div>
      ))}

      <button type="button" onClick={handleSave}>
        Save Platform Settings
      </button>

      {savedMessage && <p>{savedMessage}</p>}
    </section>
  );
}
