import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDateTime, priorityLabels } from "../time.js";

export default function Queue() {
  const [platforms, setPlatforms] = useState([]);
  const [posts, setPosts] = useState([]);
  const [failedPosts, setFailedPosts] = useState([]);
  const [timezone, setTimezone] = useState();
  const [editing, setEditing] = useState(null); // { id, caption, hashtags, altText }
  const [message, setMessage] = useState("");

  async function load() {
    const [allPlatforms, queuedPosts, failed, status] = await Promise.all([
      api.platforms(),
      api.posts("queued"),
      api.posts("failed"),
      api.status(),
    ]);
    setPlatforms(allPlatforms);
    setPosts(queuedPosts);
    setFailedPosts(failed);
    setTimezone(status.timezone);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  // Every change reprojects the whole queue on the server, so reload afterwards
  async function run(action) {
    try {
      await action();
      setMessage("");
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    } finally {
      await load().catch((error) => setMessage(error.message));
    }
  }

  function updatePriority(post, priority) {
    run(() => api.updatePost(post.id, { priority }));
  }

  function updateOverrideDate(post, overrideDate) {
    run(() => api.updatePost(post.id, { overrideDate: overrideDate || null }));
  }

  // Reordering only works among posts of the same priority without an override date
  function movePost(post, direction) {
    run(() => api.movePost(post.id, direction));
  }

  function removePost(post) {
    run(() => api.deletePost(post.id));
  }

  function requeuePost(post) {
    run(() => api.requeuePost(post.id));
  }

  async function saveEdit() {
    const { id, ...changes } = editing;
    if (await run(() => api.updatePost(id, changes))) setEditing(null);
  }

  const platformName = (id) => platforms.find((p) => p.id === id)?.name ?? "Unknown";

  return (
    <section>
      <h1>Queue</h1>

      {message && <p className="error-text">{message}</p>}

      {failedPosts.length > 0 && (
        <div>
          <h2>Failed to send</h2>

          {failedPosts.map((post) => (
            <div key={post.id}>
              <h3>
                {platformName(post.platformId)} — {post.caption}
              </h3>

              <p className="error-text">{post.lastError}</p>

              <p>
                Was due {post.scheduledAt ? formatDateTime(post.scheduledAt, timezone) : "unknown"}.
                Requeueing puts it at the front of the {platformName(post.platformId)} queue.
              </p>

              <button type="button" onClick={() => requeuePost(post)}>
                Requeue
              </button>

              <button type="button" onClick={() => removePost(post)}>
                Remove
              </button>

              <hr />
            </div>
          ))}
        </div>
      )}

      {platforms.map((platform) => {
        const platformPosts = posts.filter(
          (post) => post.platformId === platform.id
        );

        return (
          <div key={platform.id}>
            <h2>
              {platform.name}
              {platform.paused ? " (paused)" : ""}
            </h2>

            {platformPosts.length === 0 ? (
              <p>No posts in queue.</p>
            ) : (
              platformPosts.map((post, index) => {
                const sameGroup = platformPosts.filter(
                  (p) => !p.overrideDate && p.priority === post.priority
                );
                const groupIndex = sameGroup.indexOf(post);
                const isEditing = editing?.id === post.id;

                return (
                  <div key={post.id}>
                    {isEditing ? (
                      <div>
                        <label htmlFor={`caption-${post.id}`}>Caption</label>
                        <textarea
                          id={`caption-${post.id}`}
                          rows="4"
                          value={editing.caption}
                          onChange={(event) => setEditing({ ...editing, caption: event.target.value })}
                        />

                        <label htmlFor={`hashtags-${post.id}`}>Hashtags</label>
                        <input
                          id={`hashtags-${post.id}`}
                          type="text"
                          value={editing.hashtags}
                          onChange={(event) => setEditing({ ...editing, hashtags: event.target.value })}
                        />

                        {post.mediaId && (
                          <>
                            <label htmlFor={`altText-${post.id}`}>Alt Text</label>
                            <input
                              id={`altText-${post.id}`}
                              type="text"
                              value={editing.altText}
                              onChange={(event) => setEditing({ ...editing, altText: event.target.value })}
                            />
                          </>
                        )}

                        <button type="button" onClick={saveEdit}>
                          Save
                        </button>

                        <button type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3>
                          #{index + 1} — {post.caption}
                        </h3>

                        {post.hashtags && (
                          <p>{post.hashtags}</p>
                        )}
                      </>
                    )}

                    {post.mediaLink && (
                      <p>
                        <strong>Image:</strong>{" "}
                        <a href={post.mediaLink} target="_blank" rel="noreferrer">
                          {post.mediaName}
                        </a>
                        {post.altText && ` (alt text: ${post.altText})`}
                      </p>
                    )}

                    <p>
                      Scheduled:{" "}
                      <strong>
                        {post.scheduledAt
                          ? formatDateTime(post.scheduledAt, timezone)
                          : "No slot available"}
                      </strong>
                      {post.priority === 2
                        ? " (next day)"
                        : post.overrideDate
                          ? " (override date)"
                          : ""}
                    </p>

                    <div>
                      <label htmlFor={`priority-${post.id}`}>
                        Priority
                      </label>

                      <select
                        id={`priority-${post.id}`}
                        value={post.priority}
                        onChange={(event) =>
                          updatePriority(post, Number(event.target.value))
                        }
                      >
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: post.id, caption: post.caption, hashtags: post.hashtags, altText: post.altText })
                        }
                      >
                        Edit
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        movePost(post, "up")
                      }
                      disabled={groupIndex <= 0}
                    >
                      Move Up
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        movePost(post, "down")
                      }
                      disabled={groupIndex === -1 || groupIndex === sameGroup.length - 1}
                    >
                      Move Down
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        removePost(post)
                      }
                    >
                      Remove
                    </button>

                    <div>
                      <label htmlFor={`overrideDate-${post.id}`}>
                        Override Date (Optional)
                      </label>

                      <input
                        id={`overrideDate-${post.id}`}
                        type="date"
                        value={post.overrideDate ?? ""}
                        disabled={post.priority === 2}
                        onChange={(event) =>
                          updateOverrideDate(
                            post,
                            event.target.value
                          )
                        }
                      />
                    </div>

                    <hr />
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </section>
  );
}