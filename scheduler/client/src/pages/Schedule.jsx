// Deliverable 3: projected calendar of upcoming posts, mirrored to Google Calendar.
// TODO(Sprint 4): week/month view of projected slots, colored by platform.
import { useEffect, useMemo, useState } from "react";

const defaultTimes = {
  facebook: "12:00 PM",
  instagram: "10:00 AM",
  linkedin: "9:00 AM",
};

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

function getPlatformClass(platform) {
  return `schedule-post ${platform}`;
}

function capitalizePlatform(platform) {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export default function Schedule() {
  const [view, setView] = useState("week");
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const savedPosts =
      JSON.parse(localStorage.getItem("ctrPosts")) || [];

    setPosts(savedPosts);
  }, []);

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
    .filter((post) => post.overrideDate)
    .map((post) => ({
      ...post,
      date: post.overrideDate,
      time: defaultTimes[post.platform] || "",
    }));

  const unscheduledPosts = posts.filter(
    (post) => !post.overrideDate
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
  setCurrentDate(new Date());
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

      <div className="schedule-legend">
        <span className="legend-item facebook-dot">
          Facebook
        </span>

        <span className="legend-item instagram-dot">
          Instagram
        </span>

        <span className="legend-item linkedin-dot">
          LinkedIn
        </span>
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
                        className={getPlatformClass(
                          post.platform
                        )}
                            key={post.id}
                            onClick={() => setSelectedPost(post)}
                            role="button"
                            tabIndex={0}
                      >
                        <strong>
                          {capitalizePlatform(
                            post.platform
                          )}
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
                    className={getPlatformClass(
                      post.platform
                    )}
                    key={post.id}
                    onClick={() => setSelectedPost(post)}
                    role="button"
                    tabIndex={0}
                  >
                    <strong>
                      {capitalizePlatform(
                        post.platform
                      )}
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

            <button
              type="button"
              onClick={() => setSelectedPost(null)}
            >
              Close
            </button>
          </div>

          <p>
            <strong>Platform:</strong>{" "}
            {capitalizePlatform(selectedPost.platform)}
          </p>

          <p>
            <strong>Date:</strong> {selectedPost.date}
          </p>

          <p>
            <strong>Time:</strong> {selectedPost.time}
          </p>

          <p>
            <strong>Priority:</strong>{" "}
            {selectedPost.priority === "high"
              ? "High"
              : "Normal"}
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

          {selectedPost.imageName && (
            <p>
              <strong>Image:</strong>{" "}
              {selectedPost.imageName}
            </p>
          )}
        </div>
      )}

      {unscheduledPosts.length > 0 && (
        <p className="schedule-note">
          {unscheduledPosts.length} queued post
          {unscheduledPosts.length !== 1 ? "s" : ""} waiting
          for the scheduler to assign projected posting slots.
        </p>
      )}

      <p className="schedule-note">
        Posts with override dates are shown immediately.
        Automatic projected scheduling and Google Calendar
        synchronization will use the scheduler backend.
      </p>
    </section>
  );
}