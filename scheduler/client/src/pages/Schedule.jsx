// Deliverable 3: projected calendar of upcoming posts, mirrored to Google Calendar.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { platformColor } from "../calendarColors.js";
import { formatTime, priorityLabels, zonedParts } from "../time.js";

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDayName(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
  });
}


export default function Schedule() {
  const [view, setView] = useState("week");
  const [posts, setPosts] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [timezone, setTimezone] = useState();
  const [appNow, setAppNow] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [message, setMessage] = useState("");

  async function load() {
    const [queuedPosts, allPlatforms, status] = await Promise.all([
      // Sent posts stay on the calendar so the team can see what went out
      api.posts("queued,sending,posted,failed"),
      api.platforms(),
      api.status(),
    ]);
    setPosts(queuedPosts);
    setPlatforms(allPlatforms);
    setTimezone(status.timezone);
    // In test mode the app clock can be moved, so "today" comes from the server
    setAppNow(new Date(status.now));
    return status;
  }

  useEffect(() => {
    load()
      .then((status) => setCurrentDate(new Date(status.now)))
      .catch((error) => setMessage(error.message));
  }, []);

  const platformById = new Map(
    platforms.map((platform) => [platform.id, platform])
  );

  function platformName(post) {
    return platformById.get(post.platformId)?.name ?? "Unknown";
  }

  function platformStyle(post) {
    return { borderLeftColor: platformColor(platformById.get(post.platformId)) };
  }

  const today = currentDate;

  const weekDays = useMemo(() => {
    const currentDay = today.getDay();

    const mondayOffset =
      currentDay === 0 ? -6 : 1 - currentDay;

    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);

      return date;
    });
  }, [currentDate]);



  const monthDays = useMemo(() => {
    const year = today.getFullYear();
    const month = today.getMonth();

    const firstDay = new Date(year, month, 1);
    const totalDays = new Date(year, month + 1, 0).getDate();

    const leadingBlankCount =
      (firstDay.getDay() + 6) % 7;

    const leadingBlanks = Array.from(
      { length: leadingBlankCount },
      () => null
    );

    const actualDays = Array.from(
      { length: totalDays },
      (_, index) =>
        new Date(year, month, index + 1)
    );

    return [...leadingBlanks, ...actualDays];
  }, [currentDate]);


  const scheduledPosts = posts
    .filter((post) => post.scheduledAt)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((post) => ({
      ...post,
      date: zonedParts(post.scheduledAt, timezone).date,
      time: formatTime(post.scheduledAt, timezone),
    }));

  const unscheduledPosts = posts.filter(
    (post) => !post.scheduledAt
  );

  function goPrevious() {
  setSelectedPost(null);

  setCurrentDate((current) => {
    const newDate = new Date(current);

    if (view === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }

    return newDate;
  });
}

function goNext() {
  setSelectedPost(null);

  setCurrentDate((current) => {
    const newDate = new Date(current);

    if (view === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }

    return newDate;
  });
}

function goToday() {
  setSelectedPost(null);
  setCurrentDate(appNow);
}

const calendarTitle =
  view === "week"
    ? `${weekDays[0].toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })} - ${weekDays[6].toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : currentDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

async function removeScheduledPost(id) {
  try {
    await api.deletePost(id);
    setMessage("");
  } catch (error) {
    setMessage(error.message);
    return;
  }

  if (selectedPost?.id === id) {
    setSelectedPost(null);
  }

  await load().catch((error) => setMessage(error.message));
}

  return (
    <section>
      <div className="schedule-header">
        <div>
          <h1>Schedule</h1>
          <p>Projected posting calendar</p>
        </div>

        <div className="schedule-controls">
          <div className="calendar-navigation">
            <button type="button" onClick={goPrevious}>
              Previous
            </button>

            <button type="button" onClick={goToday}>
              Today
            </button>

            <button type="button" onClick={goNext}>
              Next
            </button>
          </div>

          <div className="view-toggle">
            <button
              type="button"
              onClick={() => setView("week")}
              className={view === "week" ? "active-view" : ""}
            >
              Week
            </button>

            <button
              type="button"
              onClick={() => setView("month")}
              className={view === "month" ? "active-view" : ""}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      <h2 className="calendar-title">
        {calendarTitle}
      </h2>

      {message && <p className="error-text">{message}</p>}

      <div className="schedule-legend">
        {platforms.map((platform) => (
          <span
            className="legend-item"
            key={platform.id}
            style={{ "--legend-color": platformColor(platform) }}
          >
            {platform.name}
          </span>
        ))}
      </div>

      {view === "week" ? (
        <div className="week-grid">
          {weekDays.map((date) => {
            const dateKey = formatDateKey(date);

            const postsForDay =
              scheduledPosts.filter(
                (post) => post.date === dateKey
              );

            return (
              <div
                className="day-column"
                key={dateKey}
              >
                <div className="day-heading">
                  <strong>
                    {formatDayName(date)}
                  </strong>

                  <span>{date.getDate()}</span>
                </div>

                <div className="day-content">
                  {postsForDay.length === 0 ? (
                    <p className="empty-slot">
                      No posts
                    </p>
                  ) : (
                    postsForDay.map((post) => (
                      <div
                        className="schedule-post"
                        style={platformStyle(post)}
                        key={post.id}
                        onClick={() => setSelectedPost(post)}
                        role="button"
                        tabIndex={0}
                      >
                        <strong>
                          {platformName(post)}
                        </strong>

                        <span>{post.time}</span>

                        <p>{post.caption}</p>
                        
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        
      <div className="month-calendar">
        <div className="month-weekdays">
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
          <div>Sun</div>
        </div>

        <div className="month-grid">
          {monthDays.map((date, index) => {
            if (!date) {
              return (
                <div
                  className="month-day month-day-empty"
                  key={`empty-${index}`}
                />
              );
            }

            const dateKey = formatDateKey(date);

            const postsForDay =
              scheduledPosts.filter(
                (post) => post.date === dateKey
              );

            return (
              <div
                className="month-day"
                key={dateKey}
              >
                <div className="month-day-number">
                  {date.getDate()}
                </div>

                {postsForDay.map((post) => (
                  <div
                    className="schedule-post"
                    style={platformStyle(post)}
                    key={post.id}
                    onClick={() => setSelectedPost(post)}
                    role="button"
                    tabIndex={0}
                  >
                    <strong>
                      {platformName(post)}
                    </strong>

                    <span>{post.time}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {selectedPost && (
        <div className="post-details">
          <div className="post-details-header">
            <h2>Post Details</h2>

            <div className="post-detail-actions">
              {selectedPost.status === "queued" && (
                <button
                  type="button"
                  className="remove-button"
                  onClick={() => removeScheduledPost(selectedPost.id)}
                >
                  Remove
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedPost(null)}
              >
                Close
              </button>
            </div>
          </div>
          <p>
            <strong>Platform:</strong>{" "}
            {platformName(selectedPost)}
          </p>

          <p>
            <strong>Date:</strong> {selectedPost.date}
          </p>

          <p>
            <strong>Time:</strong> {selectedPost.time}
            {selectedPost.priority === 2
              ? " (next day)"
              : selectedPost.overrideDate
                ? " (override date)"
                : ""}
          </p>

          <p>
            <strong>Priority:</strong>{" "}
            {priorityLabels[selectedPost.priority]}
          </p>

          <p>
            <strong>Caption:</strong>{" "}
            {selectedPost.caption}
          </p>

          {selectedPost.hashtags && (
            <p>
              <strong>Hashtags:</strong>{" "}
              {selectedPost.hashtags}
            </p>
          )}

          {selectedPost.mediaLink && (
            <p>
              <strong>Image:</strong>{" "}
              <a href={selectedPost.mediaLink} target="_blank" rel="noreferrer">
                {selectedPost.mediaName}
              </a>
              {selectedPost.altText && ` (alt text: ${selectedPost.altText})`}
            </p>
          )}

          <p>
            <strong>Status:</strong> {selectedPost.status}
            {selectedPost.lastError && ` — ${selectedPost.lastError}`}
          </p>
        </div>
      )}

      {unscheduledPosts.length > 0 && (
        <p className="schedule-note">
          {unscheduledPosts.length} queued post
          {unscheduledPosts.length !== 1 ? "s" : ""} have no
          posting slot. Check that the platform has posting days
          and a time, and is not paused.
        </p>
      )}

      <p className="schedule-note">
        Each post appears in Google Calendar at the time shown here.
        Times are in {timezone ?? "the app time zone"}.
      </p>
    </section>
  );
}