// Deliverable 2: posting days, times, and calendar color per platform.
// Saving regenerates each platform's future, unlocked slots and updates its calendar events.

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

  // Post type edits save right away and return the whole platform
  function replacePlatform(saved) {
    setPlatforms((current) => current.map((p) => (p.id === saved.id ? saved : p)));
  }

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
      setSavedMessage("Platform settings saved. Future unlocked slots have been regenerated.");
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

          <PostTypeEditor platform={platform} onChange={replacePlatform} />

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

// Add, rename, or move a post type in or out of the monthly rotation.
// Types outside the rotation (like Holiday) are only for Specific Date posts.
function PostTypeEditor({ platform, onChange }) {
  const [names, setNames] = useState({});
  const [newName, setNewName] = useState("");
  const [newInRotation, setNewInRotation] = useState(true);
  const [message, setMessage] = useState("");
  const types = [...(platform.postTypes ?? [])].sort(
    (a, b) => Number(b.inRotation) - Number(a.inRotation) || a.sortOrder - b.sortOrder
  );

  async function save(type, changes) {
    try {
      onChange(await api.updatePostType(platform.id, type.id, changes));
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function rename(type) {
    const name = (names[type.id] ?? type.name).trim();
    if (name && name !== type.name) await save(type, { name });
    setNames((current) => ({ ...current, [type.id]: undefined }));
  }

  async function add(event) {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      onChange(await api.addPostType(platform.id, { name: newName.trim(), inRotation: newInRotation }));
      setNewName("");
      setNewInRotation(true);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div>
      <strong>Post Types</strong>

      <ul className="post-type-list">
        {types.map((type) => (
          <li key={type.id}>
            <input
              type="text"
              aria-label={`Rename ${type.name}`}
              value={names[type.id] ?? type.name}
              onChange={(event) => setNames({ ...names, [type.id]: event.target.value })}
              onBlur={() => rename(type)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
            <label>
              <input
                type="checkbox"
                checked={type.inRotation}
                onChange={(event) => save(type, { inRotation: event.target.checked })}
              />
              In monthly rotation
            </label>
          </li>
        ))}
      </ul>

      <form className="post-type-add" onSubmit={add}>
        <input
          type="text"
          aria-label="New post type name"
          placeholder="New post type"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <label>
          <input type="checkbox" checked={newInRotation} onChange={(event) => setNewInRotation(event.target.checked)} />
          In monthly rotation
        </label>
        <button type="submit">Add Post Type</button>
      </form>

      {message && <p className="error-text">{message}</p>}

      <p className="field-hint">
        Slots repeat the rotation types in this order
        {platform.usesColors ? " and alternate Blue and Purple." : ". This platform does not use colors."}
        {" "}Types outside the rotation, like Holiday, are for Specific Date posts.
      </p>
    </div>
  );
}
