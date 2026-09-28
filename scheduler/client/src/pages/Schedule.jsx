// Deliverable 3: projected calendar of upcoming posts, mirrored to Google Calendar.
// TODO(Sprint 4): week/month view of projected slots, colored by platform.
import { useState } from "react";

const projectedPosts = [
  {
    id: 1,
    platform: "facebook",
    caption: "Thank you to our amazing volunteers!",
    date: "2026-09-28",
    time: "12:00 PM",
  },
  {
    id: 2,
    platform: "instagram",
    caption: "Making meaningful connections every week.",
    date: "2026-09-29",
    time: "10:00 AM",
  },
  {
    id: 3,
    platform: "linkedin",
    caption: "Learn more about Conversations to Remember.",
    date: "2026-09-30",
    time: "9:00 AM",
  },
  {
    id: 4,
    platform: "facebook",
    caption: "Meet one of our student volunteers.",
    date: "2026-10-02",
    time: "12:00 PM",
  },
];

export default function Schedule() {
  const [view, setView] = useState("week");

  const formatDate = (date) => {
    return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <section>
      <h1>Schedule</h1>

      <div>
        <button
          type="button"
          onClick={() => setView("week")}
          disabled={view === "week"}
        >
          Week
        </button>

        <button
          type="button"
          onClick={() => setView("month")}
          disabled={view === "month"}
        >
          Month
        </button>
      </div>

      <p>
        View: <strong>{view === "week" ? "Week" : "Month"}</strong>
      </p>

      <h2>Projected Posts</h2>

      {projectedPosts.length === 0 ? (
        <p>No projected posts.</p>
      ) : (
        projectedPosts.map((post) => (
          <div key={post.id}>
            <h3>
              {post.platform.charAt(0).toUpperCase() +
                post.platform.slice(1)}
            </h3>

            <p>
              <strong>Date:</strong> {formatDate(post.date)}
            </p>

            <p>
              <strong>Time:</strong> {post.time}
            </p>

            <p>
              <strong>Post:</strong> {post.caption}
            </p>

            <hr />
          </div>
        ))
      )}

      <p>
        These are projected posting times. Google Calendar synchronization
        will use the scheduler backend.
      </p>
    </section>
  );
}
