// Deliverable 2: per-platform queue with priority and ordering.
// TODO(Sprint 4): list per platform, reorder, priority toggle, override date.
import { useState } from "react";

const initialPosts = [
  {
    id: 1,
    platform: "facebook",
    caption: "Thank you to our amazing volunteers!",
    hashtags: "#volunteer #community",
    priority: "normal",
    overrideDate: "",
  },
  {
    id: 2,
    platform: "facebook",
    caption: "Meet one of our student volunteers.",
    hashtags: "#volunteer #CTR",
    priority: "high",
    overrideDate: "",
  },
  {
    id: 3,
    platform: "instagram",
    caption: "Making meaningful connections every week.",
    hashtags: "#community #seniors",
    priority: "normal",
    overrideDate: "",
  },
  {
    id: 4,
    platform: "linkedin",
    caption: "Learn more about Conversations to Remember.",
    hashtags: "#nonprofit #community",
    priority: "normal",
    overrideDate: "",
  },
];

const platforms = ["facebook", "instagram", "linkedin"];

export default function Queue() {
  const [posts, setPosts] = useState(initialPosts);

  function togglePriority(id) {
    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === id
          ? {
              ...post,
              priority: post.priority === "high" ? "normal" : "high",
            }
          : post
      )
    );
  }

  function updateOverrideDate(id, date) {
    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === id
          ? {
              ...post,
              overrideDate: date,
            }
          : post
      )
    );
  }

  function movePost(id, direction) {
    setPosts((currentPosts) => {
      const updatedPosts = [...currentPosts];
      const currentIndex = updatedPosts.findIndex((post) => post.id === id);

      if (currentIndex === -1) {
        return currentPosts;
      }

      const currentPost = updatedPosts[currentIndex];

      const platformIndexes = updatedPosts
        .map((post, index) =>
          post.platform === currentPost.platform ? index : -1
        )
        .filter((index) => index !== -1);

      const position = platformIndexes.indexOf(currentIndex);

      if (direction === "up" && position > 0) {
        const targetIndex = platformIndexes[position - 1];

        [updatedPosts[currentIndex], updatedPosts[targetIndex]] = [
          updatedPosts[targetIndex],
          updatedPosts[currentIndex],
        ];
      }

      if (
        direction === "down" &&
        position < platformIndexes.length - 1
      ) {
        const targetIndex = platformIndexes[position + 1];

        [updatedPosts[currentIndex], updatedPosts[targetIndex]] = [
          updatedPosts[targetIndex],
          updatedPosts[currentIndex],
        ];
      }

      return updatedPosts;
    });
  }

  return (
    <section>
      <h1>Queue</h1>

      {platforms.map((platform) => {
        const platformPosts = posts.filter(
          (post) => post.platform === platform
        );

        return (
          <div key={platform}>
            <h2>
              {platform.charAt(0).toUpperCase() + platform.slice(1)}
            </h2>

            {platformPosts.length === 0 ? (
              <p>No posts in queue.</p>
            ) : (
              platformPosts.map((post, index) => (
                <div key={post.id}>
                  <h3>
                    #{index + 1} — {post.caption}
                  </h3>

                  <p>{post.hashtags}</p>

                  <p>
                    Priority:{" "}
                    <strong>
                      {post.priority === "high" ? "High" : "Normal"}
                    </strong>
                  </p>

                  <button
                    type="button"
                    onClick={() => togglePriority(post.id)}
                  >
                    Toggle Priority
                  </button>

                  <button
                    type="button"
                    onClick={() => movePost(post.id, "up")}
                    disabled={index === 0}
                  >
                    Move Up
                  </button>

                  <button
                    type="button"
                    onClick={() => movePost(post.id, "down")}
                    disabled={index === platformPosts.length - 1}
                  >
                    Move Down
                  </button>

                  <div>
                    <label htmlFor={`overrideDate-${post.id}`}>
                      Override Date (Optional)
                    </label>

                    <input
                      id={`overrideDate-${post.id}`}
                      type="date"
                      value={post.overrideDate}
                      onChange={(event) =>
                        updateOverrideDate(
                          post.id,
                          event.target.value
                        )
                      }
                    />
                  </div>

                  <hr />
                </div>
              ))
            )}
          </div>
        );
      })}
    </section>
  );
}