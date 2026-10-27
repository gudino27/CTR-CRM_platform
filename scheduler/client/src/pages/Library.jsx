// Library posts waiting for a slot, everything already placed, and failed sends, per platform.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDate, formatDateTime, formatLocal, zonedParts } from "../time.js";
import {
  ColorBadge, ColorRadios, ConflictNotice, PostTypeSelect, TypeBadge, colorClass, splitFixedAt,
} from "../components/PostFields.jsx";

function oldestFirst(a, b) {
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id - b.id;
}

function bySchedule(a, b) {
  return (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "") || a.id - b.id;
}

export default function Library() {
  const [platforms, setPlatforms] = useState([]);
  const [posts, setPosts] = useState([]);
  const [failedPosts, setFailedPosts] = useState([]);
  const [timezone, setTimezone] = useState();
  const [editing, setEditing] = useState(null); // { id, caption, hashtags, altText, postTypeId, color, date, time }
  const [conflict, setConflict] = useState(null);
  const [requeueing, setRequeueing] = useState(null); // { id, date, time } for a failed Specific Date post
  const [message, setMessage] = useState("");

  async function load() {
    const [allPlatforms, queuedPosts, failed, status] = await Promise.all([
      api.platforms(),
      api.posts({ status: "queued" }),
      api.posts({ status: "failed" }),
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

  // A change can refill slots on the server, so reload afterwards
  async function run(action) {
    try {
      await action();
      setMessage("");
      return true;
    } catch (error) {
      if (error.status === 409 && error.body?.conflict) {
        setConflict(error.body);
        setMessage("");
      } else {
        setMessage(error.message);
      }
      return false;
    } finally {
      await load().catch((error) => setMessage(error.message));
    }
  }

  function startEdit(post) {
    setConflict(null);
    setEditing({
      id: post.id,
      kind: post.kind,
      caption: post.caption,
      hashtags: post.hashtags ?? "",
      altText: post.altText ?? "",
      postTypeId: post.postTypeId,
      color: post.color,
      // A library post starts from the slot it's in, so changing its date begins from the current one
      ...(post.fixedAt ? splitFixedAt(post.fixedAt) : post.scheduledAt ? zonedParts(post.scheduledAt, timezone) : { date: "", time: "" }),
    });
  }

  // Switching a post between Library (next matching slot) and Specific Date (fixed date and time)
  function setEditKind(post, kind) {
    const platform = platforms.find((p) => p.id === post.platformId);
    const rotation = platform?.postTypes?.filter((type) => type.inRotation) ?? [];
    setConflict(null);
    setEditing((current) => ({
      ...current,
      kind,
      time: current.time || [...(platform?.postingTimes ?? [])].sort()[0] || "",
      // Library posts need a rotation type (not Holiday)
      postTypeId: kind === "library" && !rotation.some((type) => type.id === current.postTypeId)
        ? rotation[0]?.id ?? null
        : current.postTypeId,
      color: kind === "library" && platform?.usesColors && !current.color ? "Blue" : current.color,
    }));
  }

  async function saveEdit(force = false) {
    const { id, kind, date, time, postTypeId, color, ...text } = editing;
    const platform = platforms.find((p) => p.id === posts.find((post) => post.id === id)?.platformId);
    if (kind === "fixed" && (!date || !time)) {
      setMessage("Choose a date and a time.");
      return;
    }
    const typeAndColor = { postTypeId, color: platform?.usesColors ? color : null };
    const changes = kind === "fixed"
      ? { ...text, ...typeAndColor, kind, fixedAt: `${date}T${time}` }
      : { ...text, ...typeAndColor, kind };
    if (force) changes.force = true;

    if (await run(() => api.updatePost(id, changes))) {
      setEditing(null);
      setConflict(null);
    }
  }

  function removePost(post) {
    if (editing?.id === post.id) setEditing(null);
    run(() => api.deletePost(post.id));
  }

  async function requeuePost(post) {
    if (post.kind === "fixed") {
      if (!requeueing?.date || !requeueing?.time) {
        setMessage("Choose a new date and time before requeueing a Specific Date post.");
        return;
      }
      if (await run(() => api.requeuePost(post.id, { fixedAt: `${requeueing.date}T${requeueing.time}` }))) {
        setRequeueing(null);
      }
      return;
    }
    run(() => api.requeuePost(post.id));
  }

  function editForm(post, platform) {
    return (
      <div className="edit-form">
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

        <span className="field-label">When to post</span>
        <div className="mode-toggle" role="group" aria-label="When to post">
          <button
            type="button"
            className={editing.kind === "library" ? "active-view" : ""}
            onClick={() => setEditKind(post, "library")}
          >
            Library (next matching slot)
          </button>
          <button
            type="button"
            className={editing.kind === "fixed" ? "active-view" : ""}
            onClick={() => setEditKind(post, "fixed")}
          >
            Specific Date
          </button>
        </div>

        {editing.kind === "fixed" && (
          <div className="date-time-row">
            <div>
              <label htmlFor={`date-${post.id}`}>Date</label>
              <input
                id={`date-${post.id}`}
                type="date"
                value={editing.date}
                onChange={(event) => { setEditing({ ...editing, date: event.target.value }); setConflict(null); }}
              />
            </div>
            <div>
              <label htmlFor={`time-${post.id}`}>Time</label>
              <input
                id={`time-${post.id}`}
                type="time"
                value={editing.time}
                onChange={(event) => { setEditing({ ...editing, time: event.target.value }); setConflict(null); }}
              />
            </div>
          </div>
        )}

        <label htmlFor={`postType-${post.id}`}>Post Type</label>
        <PostTypeSelect
          id={`postType-${post.id}`}
          platform={platform}
          value={editing.postTypeId}
          onChange={(postTypeId) => {
            const type = platform.postTypes?.find((t) => t.id === postTypeId);
            setEditing({ ...editing, postTypeId });
            // A type outside the rotation (Holiday) needs a date, so switch to Specific Date
            if (type && !type.inRotation && editing.kind === "library") setEditKind(post, "fixed");
          }}
        />

        {platform.usesColors && (
          <>
            <span className="field-label">Color</span>
            <ColorRadios
              name={`color-${post.id}`}
              value={editing.color}
              onChange={(color) => setEditing({ ...editing, color })}
            />
          </>
        )}
        {conflict && (
          <ConflictNotice
            conflict={conflict}
            onUseSuggested={(suggestedAt) => {
              setEditing({ ...editing, ...splitFixedAt(suggestedAt) });
              setConflict(null);
            }}
            onForce={() => saveEdit(true)}
          />
        )}

        <button type="button" onClick={() => saveEdit()}>
          Save
        </button>

        <button type="button" className="secondary-button" onClick={() => { setEditing(null); setConflict(null); }}>
          Cancel
        </button>
      </div>
    );
  }

  function postCard(post, platform, { showAdded = false } = {}) {
    const isEditing = editing?.id === post.id;
    const fixed = post.kind === "fixed";

    return (
      <div key={post.id} className={`library-post library-post-${fixed ? "fixed" : colorClass(post.color)}`}>
        <div className="badge-row">
          {fixed ? <span className="badge badge-fixed">Specific Date</span> : <TypeBadge name={post.postTypeName} />}
          {!fixed && <ColorBadge color={post.color} />}
          {showAdded && <span className="field-hint">Added {formatDate(post.createdAt, timezone)}</span>}
        </div>

        {isEditing ? (
          editForm(post, platform)
        ) : (
          <>
            <p className="library-caption">{post.caption}</p>
            {post.hashtags && <p className="field-hint">{post.hashtags}</p>}
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

        {!showAdded && (
          <p>
            Scheduled:{" "}
            <strong>
              {fixed && post.fixedAt
                ? formatLocal(post.fixedAt)
                : post.scheduledAt
                  ? formatDateTime(post.scheduledAt, timezone)
                  : "Waiting for a slot"}
            </strong>
          </p>
        )}

        {!isEditing && (
          <div className="post-actions">
            <button type="button" onClick={() => startEdit(post)}>
              Edit
            </button>
            <button type="button" className="remove-button" onClick={() => removePost(post)}>
              Remove
            </button>
          </div>
        )}
      </div>
    );
  }

  function failedCard(post) {
    const fixed = post.kind === "fixed";
    const picking = requeueing?.id === post.id;

    return (
      <div key={post.id} className="library-post library-post-failed">
        <div className="badge-row">
          {fixed ? <span className="badge badge-fixed">Specific Date</span> : <TypeBadge name={post.postTypeName} />}
          {!fixed && <ColorBadge color={post.color} />}
        </div>

        <p className="library-caption">{post.caption}</p>
        <p className="error-text">{post.lastError}</p>
        <p>
          Was due {post.scheduledAt ? formatDateTime(post.scheduledAt, timezone) : "unknown"}.{" "}
          {fixed
            ? "Choose a new date and time to requeue it."
            : "Requeueing puts it back in the library, where it fills the next empty matching slot."}
        </p>

        {fixed && (
          <div className="date-time-row">
            <div>
              <label htmlFor={`requeueDate-${post.id}`}>New Date</label>
              <input
                id={`requeueDate-${post.id}`}
                type="date"
                value={picking ? requeueing.date : ""}
                onChange={(event) => setRequeueing({ time: "", ...(picking ? requeueing : {}), id: post.id, date: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`requeueTime-${post.id}`}>New Time</label>
              <input
                id={`requeueTime-${post.id}`}
                type="time"
                value={picking ? requeueing.time : ""}
                onChange={(event) => setRequeueing({ date: "", ...(picking ? requeueing : {}), id: post.id, time: event.target.value })}
              />
            </div>
          </div>
        )}

        <div className="post-actions">
          <button
            type="button"
            onClick={() => requeuePost(post)}
            disabled={fixed && !(picking && requeueing.date && requeueing.time)}
          >
            Requeue
          </button>
          <button type="button" className="remove-button" onClick={() => removePost(post)}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <h1>Library</h1>
      <p>
        Library posts fill the next empty slot with the same post type and color, oldest first.
        Specific Date posts stay where you put them.
      </p>

      {message && <p className="error-text">{message}</p>}

      {platforms.map((platform) => {
        const platformPosts = posts.filter((post) => post.platformId === platform.id);
        const waiting = platformPosts.filter((post) => post.kind === "library" && !post.slotId).sort(oldestFirst);
        const scheduled = platformPosts.filter((post) => post.kind === "fixed" || post.slotId).sort(bySchedule);
        const failed = failedPosts.filter((post) => post.platformId === platform.id);

        return (
          <div key={platform.id} className="library-platform">
            <h2>
              {platform.name}
              {platform.paused ? " (paused)" : ""}
            </h2>

            <h3>Waiting in library ({waiting.length})</h3>
            {waiting.length === 0 ? (
              <p className="field-hint">Nothing waiting. New library posts appear here until a matching slot opens.</p>
            ) : (
              <div className="library-list">{waiting.map((post) => postCard(post, platform, { showAdded: true }))}</div>
            )}

            <h3>Scheduled ({scheduled.length})</h3>
            {scheduled.length === 0 ? (
              <p className="field-hint">No scheduled posts.</p>
            ) : (
              <div className="library-list">{scheduled.map((post) => postCard(post, platform))}</div>
            )}

            {failed.length > 0 && (
              <>
                <h3 className="error-text">Failed to send ({failed.length})</h3>
                <div className="library-list">{failed.map(failedCard)}</div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
