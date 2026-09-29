// Deliverable 2: posting days, times, and calendar color per platform.
// Saving reprojects each platform's queue and updates its calendar events.

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { calendarColors } from "../calendarColors.js";

// API day codes with the labels shown on the page
const days = [
  ["MON", "Monday"],
  ["TUE", "Tuesday"],
  ["WED", "Wednesday"],
  ["THU", "Thursday"],
  ["FRI", "Friday"],
  ["SAT", "Saturday"],
  ["SUN", "Sunday"],
];

export default function Platforms() {
  const [platforms, setPlatforms] = useState([]);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    api.platforms()
      .then(setPlatforms)
      .catch((error) => setSavedMessage(error.message));
  }, []);

  function updatePlatform(id, changes) {
    setPlatforms((currentPlatforms) =>
      currentPlatforms.map((platform) =>
        platform.id === id
          ? {
              ...platform,
              ...changes,
            }
          : platform
      )
    );

    setSavedMessage("");
  }

  // Only the first posting time is editable here; any extra times are kept
  function updatePostingTime(platform, postingTime) {
    updatePlatform(platform.id, {
      postingTimes: [postingTime, ...platform.postingTimes.slice(1)],
    });
  }

  function togglePostingDay(platform, day) {
    const dayIsSelected = platform.postingDays.includes(day);

    updatePlatform(platform.id, {
      postingDays: dayIsSelected
        ? platform.postingDays.filter(
            (postingDay) => postingDay !== day
          )
        : [...platform.postingDays, day],
    });
  }

  async function handleSave() {
    try {
      const saved = await Promise.all(
        platforms.map((platform) =>
          api.updatePlatform(platform.id, {
            postingDays: platform.postingDays,
            postingTimes: platform.postingTimes.filter(Boolean),
            calendarColorId: platform.calendarColorId,
          })
        )
      );

      setPlatforms(saved);
      setSavedMessage("Platform settings saved. Queues have been rescheduled.");
    } catch (error) {
      setSavedMessage(error.message);
    }
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

            {days.map(([day, label]) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={platform.postingDays.includes(day)}
                  onChange={() =>
                    togglePostingDay(platform, day)
                  }
                />

                {label}
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
              value={platform.postingTimes[0] ?? ""}
              onChange={(event) =>
                updatePostingTime(
                  platform,
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
              value={platform.calendarColorId ?? ""}
              onChange={(event) =>
                updatePlatform(platform.id, {
                  calendarColorId: event.target.value || null,
                })
              }
            >
              <option value="">Calendar default</option>
              {Object.entries(calendarColors).map(([id, color]) => (
                <option key={id} value={id}>
                  {color.name}
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
