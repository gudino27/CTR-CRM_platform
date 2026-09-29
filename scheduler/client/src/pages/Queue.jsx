import { useEffect, useState } from "react";

const platforms = [
  "facebook",
  "instagram",
  "linkedin",
];

export default function Queue() {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    const savedPosts =
      JSON.parse(localStorage.getItem("ctrPosts")) || [];

    setPosts(savedPosts);
  }, []);

  function savePosts(updatedPosts) {
    setPosts(updatedPosts);

    localStorage.setItem(
      "ctrPosts",
      JSON.stringify(updatedPosts)
    );
  }

  function togglePriority(id) {
    const updatedPosts = posts.map((post) =>
      post.id === id
        ? {
            ...post,
            priority:
              post.priority === "high"
                ? "normal"
                : "high",
          }
        : post
    );

    savePosts(updatedPosts);
  }

  function updateOverrideDate(id, date) {
    const updatedPosts = posts.map((post) =>
      post.id === id
        ? {
            ...post,
            overrideDate: date,
          }
        : post
    );

    savePosts(updatedPosts);
  }

  function updateOverrideTime(id, time) {
    const updatedPosts = posts.map((post) =>
      post.id === id
        ? {
            ...post,
            overrideTime: time,
          }
        : post
    );

    savePosts(updatedPosts);
  }

  function movePost(id, direction) {
    const updatedPosts = [...posts];

    const currentIndex = updatedPosts.findIndex(
      (post) => post.id === id
    );

    if (currentIndex === -1) {
      return;
    }

    const currentPost = updatedPosts[currentIndex];

    const platformIndexes = updatedPosts
      .map((post, index) =>
        post.platform === currentPost.platform
          ? index
          : -1
      )
      .filter((index) => index !== -1);

    const position =
      platformIndexes.indexOf(currentIndex);

    if (direction === "up" && position > 0) {
      const targetIndex =
        platformIndexes[position - 1];

      [
        updatedPosts[currentIndex],
        updatedPosts[targetIndex],
      ] = [
        updatedPosts[targetIndex],
        updatedPosts[currentIndex],
      ];
    }

    if (
      direction === "down" &&
      position < platformIndexes.length - 1
    ) {
      const targetIndex =
        platformIndexes[position + 1];

      [
        updatedPosts[currentIndex],
        updatedPosts[targetIndex],
      ] = [
        updatedPosts[targetIndex],
        updatedPosts[currentIndex],
      ];
    }

    savePosts(updatedPosts);
  }

  function removePost(id) {
    const updatedPosts = posts.filter(
      (post) => post.id !== id
    );

    savePosts(updatedPosts);
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
              {platform.charAt(0).toUpperCase() +
                platform.slice(1)}
            </h2>

            {platformPosts.length === 0 ? (
              <p>No posts in queue.</p>
            ) : (
              platformPosts.map((post, index) => (
                <div key={post.id}>
                  <h3>
                    #{index + 1} — {post.caption}
                  </h3>

                  {post.hashtags && (
                    <p>{post.hashtags}</p>
                  )}

                  {post.imageName && (
                    <p>
                      <strong>Image:</strong>{" "}
                      {post.imageName}
                    </p>
                  )}

                  <p>
                    Priority:{" "}
                    <strong>
                      {post.priority === "high"
                        ? "High"
                        : "Normal"}
                    </strong>
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      togglePriority(post.id)
                    }
                  >
                    Toggle Priority
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      movePost(post.id, "up")
                    }
                    disabled={index === 0}
                  >
                    Move Up
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      movePost(post.id, "down")
                    }
                    disabled={
                      index ===
                      platformPosts.length - 1
                    }
                  >
                    Move Down
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      removePost(post.id)
                    }
                  >
                    Remove
                  </button>

                  <div>
                    <label
                      htmlFor={`overrideDate-${post.id}`}
                    >
                      Override Date (Optional)
                    </label>

                    <input
                      id={`overrideDate-${post.id}`}
                      type="date"
                      value={
                        post.overrideDate || ""
                      }
                      onChange={(event) =>
                        updateOverrideDate(
                          post.id,
                          event.target.value
                        )
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`overrideTime-${post.id}`}>
                      Override Time (Optional)
                    </label>

                    <input
                      id={`overrideTime-${post.id}`}
                      type="time"
                      value={post.overrideTime || ""}
                      onChange={(event) =>
                        updateOverrideTime(
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