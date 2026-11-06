/**
 * Library page: per platform, the Library posts waiting for a slot, everything already
 * placed (Library posts in slots and Specific Date posts), and failed sends.
 *
 * What lives here:
 *   oldestFirst  sort for the waiting list (the order they fill slots)
 *   bySchedule   sort for the scheduled list
 *   Library      the page (route /library)
 */
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDate, formatDateTime, formatLocal, zonedParts, zoneCity } from "../time.js";
import { YourTimeHint } from "../components/TimeZone.jsx"; // viewer's own time
import {
  ColorBadge, ColorRadios, ConflictNotice, PostTypeSelect, RequiredMark, TypeBadge, colorClass, splitFixedAt,
} from "../components/PostFields.jsx";
import ImageField, { imageOfPost, imageProblem } from "../components/ImageField.jsx";
import { PreviewButton } from "../components/PostPreview.jsx";
import { useCurrentUser } from "../currentUser.js";
import { BlackoutNotice } from "../components/BlackoutDates.jsx";
import { SuggestedColorNote, useSuggestedColor } from "../components/SuggestedColor.jsx"; // color suggestion

/**
 * Sorts posts oldest first by createdAt, then by id; the order Library posts fill slots.
 *
 * Usage:
 *   waiting.sort(oldestFirst)
 *
 * Returns:
 *   A negative, zero or positive number, as Array.sort expects.
 */
function oldestFirst(a, b) {
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id - b.id;
}

/**
 * Sorts posts by scheduledAt (ISO strings compare in time order), then by id.
 *
 * Usage:
 *   scheduled.sort(bySchedule)
 */
function bySchedule(a, b) {
  return (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "") || a.id - b.id;
}

/**
 * The Library page: one block per platform with "Waiting in library", "Scheduled" and
 * "Failed to send", each post as a card with Edit and Remove (by permission), an inline
 * edit form, and Requeue for failed posts.
 *
 * Usage:
 *   Rendered by App.jsx for the /library route: <Library />
 *
 * Returns:
 *   The page section. Errors show as one red line at the top.
 *
 * How it works:
 *   1. load() fetches platforms, queued posts, failed posts and the app time zone
 *      together. Every change reloads afterwards (run()), because a change can refill
 *      slots on the server.
 *   2. Waiting = Library posts with no slot, oldest first. Scheduled = Specific Date posts
 *      and Library posts in a slot, by time.
 *   3. Buttons someone may not use are left out rather than refused: Edit needs
 *      editPosts, Remove needs deletePosts (the server checks too). Edit on a scheduled
 *      post (in a slot, or a Specific Date post) also needs editScheduledPosts; without it
 *      the card says "Ask a super admin to change a scheduled post".
 *   4. Editing (editForm) can change caption, image, alt text, post type, color and when
 *      to post. Moving a Library post to Specific Date starts from its slot's date and
 *      time. A 409 shows the collision notice with "Use <time>" and "Schedule anyway".
 *   5. Paused platforms say so: their queued posts have no time, and Specific Date posts
 *      whose time passes during the pause move to "Failed to send".
 *   6. Requeue: a Library post goes back to the library; a Specific Date post needs a new
 *      date and time first.
 *
 * When editing:
 *   PATCH /api/posts/:id and POST /api/posts/:id/requeue (server/src/routes/posts.js)
 *   do the real checks (collision window, image rules). A blackout day is only warned
 *   about (BlackoutNotice); the server does not refuse it. Times are entered and sent in
 *   the app zone (TIMEZONE in .env).
 */
export default function Library() {
  // Hidden, not refused: the server checks too
  const { permissions } = useCurrentUser();
  const canEdit = Boolean(permissions.editPosts);
  const canDelete = Boolean(permissions.deletePosts);
  // A scheduled post (in a slot, or Specific Date) also needs editScheduledPosts, like isScheduled in server/src/routes/posts.js
  const canEditPost = (post) => canEdit && (Boolean(permissions.editScheduledPosts) || !(post.kind === "fixed" || post.slotId != null));
  const [platforms, setPlatforms] = useState([]);
  const [posts, setPosts] = useState([]);
  const [failedPosts, setFailedPosts] = useState([]);
  const [timezone, setTimezone] = useState();
  const [editing, setEditing] = useState(null); // { id, kind, caption, altText, image, postTypeId, color, date, time }
  const [conflict, setConflict] = useState(null);
  const [requeueing, setRequeueing] = useState(null); // { id, date, time } for a failed Specific Date post
  const [message, setMessage] = useState("");
  // A new date for a Specific Date post preselects the color that keeps Blue/Purple
  // alternating (only when the date, time or kind changed, so opening the form changes nothing)
  const editingPost = editing && posts.find((p) => p.id === editing.id);
  const editingFixedAt = editing?.kind === "fixed" && editing.date && editing.time ? `${editing.date}T${editing.time}` : null;
  const editSuggestion = useSuggestedColor({
    platform: editingPost && platforms.find((p) => p.id === editingPost.platformId),
    date: editing?.date,
    time: editing?.time,
    exceptPostId: editing?.id,
    enabled: Boolean(editingFixedAt && editingFixedAt !== editingPost?.fixedAt),
    onSuggest: (color) => setEditing((current) => current && { ...current, color }),
  });

  /**
   * Fetches everything the page shows. Throws on any API error (callers show it).
   */
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

  /**
   * Runs one change, then always reloads, because a change can refill slots on the server.
   *
   * Usage:
   *   if (await run(() => api.updatePost(id, changes))) setEditing(null);
   *
   * Takes:
   *   action - async function that calls the API
   *
   * Returns:
   *   true on success, false on error. A 409 with a conflict body opens the collision
   *   notice; other errors show their message.
   */
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

  /**
   * Opens the edit form for a post with its current values. The date and time start from
   * fixedAt (Specific Date), or from the slot it is in (Library), so switching it to
   * Specific Date begins from its current time; otherwise empty.
   *
   * Takes:
   *   post - the post row from GET /api/posts
   */
  function startEdit(post) {
    setConflict(null);
    setEditing({
      id: post.id,
      kind: post.kind,
      caption: post.caption,
      altText: post.altText ?? "",
      image: imageOfPost(post),
      postTypeId: post.postTypeId,
      color: post.color,
      ...(post.fixedAt ? splitFixedAt(post.fixedAt) : post.scheduledAt ? zonedParts(post.scheduledAt, timezone) : { date: "", time: "" }),
    });
  }

  /**
   * Switches the post being edited between Library (next matching slot) and Specific Date
   * (fixed date and time).
   *
   * Takes:
   *   post - the post row
   *   kind - "library" or "fixed"
   *
   * How it works:
   *   - Fills an empty time with the platform's earliest posting time.
   *   - Library posts need a rotation type (not Holiday): a non-rotation type is replaced
   *     by the platform's first rotation type.
   *   - Library on a platform with colors and no color yet: picks "Blue".
   *   - Clears any collision notice.
   */
  function setEditKind(post, kind) {
    const platform = platforms.find((p) => p.id === post.platformId);
    const rotation = platform?.postTypes?.filter((type) => type.inRotation) ?? [];
    setConflict(null);
    setEditing((current) => ({
      ...current,
      kind,
      time: current.time || [...(platform?.postingTimes ?? [])].sort()[0] || "",
      postTypeId: kind === "library" && !rotation.some((type) => type.id === current.postTypeId)
        ? rotation[0]?.id ?? null
        : current.postTypeId,
      color: kind === "library" && platform?.usesColors && !current.color ? "Blue" : current.color,
    }));
  }

  /**
   * The setImage given to ImageField in the edit form. Uploads finish after the form has
   * moved on, so the image is updated from the latest state (and dropped if the form was
   * closed meanwhile).
   *
   * Takes:
   *   next - the new image, or a function of the current image (like a React setter)
   */
  function setEditImage(next) {
    setEditing((current) => current && { ...current, image: typeof next === "function" ? next(current.image) : next });
  }

  /**
   * Validates and saves the edit form.
   *
   * Usage:
   *   saveEdit()      // Save
   *   saveEdit(true)  // "Schedule anyway" in the collision notice
   *
   * Takes:
   *   force - true to save even when another Specific Date post is within the collision window
   *
   * How it works:
   *   1. Checks caption, image (imageProblem in ImageField.jsx), and for Specific Date the
   *      date and time.
   *   2. Sends caption and alt text, mediaId only when the image changed (so an old post
   *      keeps its own), post type, color (null on platforms without colors), kind, and
   *      fixedAt "YYYY-MM-DDTHH:MM" in the app zone for Specific Date.
   *   3. Closes the form on success.
   */
  async function saveEdit(force = false) {
    const { id, kind, date, time, postTypeId, color, caption, altText, image } = editing;
    const post = posts.find((p) => p.id === id);
    const platform = platforms.find((p) => p.id === post?.platformId);
    if (!caption.trim()) {
      setMessage("Please enter a caption.");
      return;
    }
    const missingImage = imageProblem(image);
    if (missingImage) {
      setMessage(missingImage);
      return;
    }
    if (kind === "fixed" && (!date || !time)) {
      setMessage("Choose a date and a time.");
      return;
    }
    // mediaId only when changed, so an old post keeps its own
    const text = { caption, altText, ...(image.media.id !== post?.mediaId ? { mediaId: image.media.id } : {}) };
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

  /**
   * Deletes a post (needs deletePosts) and closes its edit form if open. No confirm: the
   * button is only shown to people allowed to delete.
   */
  function removePost(post) {
    if (editing?.id === post.id) setEditing(null);
    run(() => api.deletePost(post.id));
  }

  /**
   * Requeues a failed post. A Library post goes back to the library and fills the next
   * matching empty slot. A Specific Date post needs the new date and time picked on its
   * card, sent as fixedAt.
   *
   * Takes:
   *   post - the failed post row
   */
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

  /**
   * The inline edit form inside a post's card.
   *
   * Takes:
   *   post     - the post being edited (editing holds the changed values)
   *   platform - its platform (post types, colors, posting times)
   *
   * Returns:
   *   JSX: caption, older posts' separate hashtags (shown, not edited), image and alt text,
   *   "Preview post", when to post, date and time (Specific Date, with the viewer's-time
   *   hint and the blackout warning), post type, color, collision notice, Save and Cancel.
   *
   * When editing:
   *   Hashtags now go in the caption; older posts keep a separate hashtags field that is
   *   sent after the caption, so the preview shows caption + "\n\n" + hashtags.
   */
  function editForm(post, platform) {
    return (
      <div className="edit-form">
        <label htmlFor={`caption-${post.id}`}>Caption <RequiredMark /></label>
        <textarea
          id={`caption-${post.id}`}
          rows="4"
          value={editing.caption}
          onChange={(event) => setEditing({ ...editing, caption: event.target.value })}
          aria-required="true"
        />
        {post.hashtags && <p className="field-hint">Hashtags saved separately (sent after the caption): {post.hashtags}</p>}

        <ImageField
          idPrefix={`edit-${post.id}`}
          image={editing.image}
          setImage={setEditImage}
          altText={editing.altText}
          setAltText={(altText) => setEditing((current) => current && { ...current, altText })}
          platformId={post.platformId}
        />

        {/* Older posts' separate hashtags are sent after the caption */}
        <PreviewButton
          platform={platform}
          caption={[editing.caption, post.hashtags].filter(Boolean).join("\n\n")}
          image={editing.image}
          altText={editing.altText}
        />

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
              <label htmlFor={`date-${post.id}`}>Date <RequiredMark /></label>
              <input
                id={`date-${post.id}`}
                type="date"
                value={editing.date}
                onChange={(event) => { setEditing({ ...editing, date: event.target.value }); setConflict(null); }}
              />
            </div>
            <div>
              <label htmlFor={`time-${post.id}`}>Time ({zoneCity(timezone)}) <RequiredMark /></label>
              <input
                id={`time-${post.id}`}
                type="time"
                value={editing.time}
                onChange={(event) => { setEditing({ ...editing, time: event.target.value }); setConflict(null); }}
              />
            </div>
          </div>
        )}
        {editing.kind === "fixed" && <YourTimeHint date={editing.date} time={editing.time} timeZone={timezone} />}
        {editing.kind === "fixed" && <BlackoutNotice platformId={platform.id} date={editing.date} />}

        <label htmlFor={`postType-${post.id}`}>Post Type <RequiredMark /></label>
        <PostTypeSelect
          id={`postType-${post.id}`}
          platform={platform}
          value={editing.postTypeId}
          onChange={(postTypeId) => {
            const type = platform.postTypes?.find((t) => t.id === postTypeId);
            setEditing({ ...editing, postTypeId });
            // Holiday-style type needs a date
            if (type && !type.inRotation && editing.kind === "library") setEditKind(post, "fixed");
          }}
        />

        {platform.usesColors && (
          <>
            <span className="field-label" id={`colorLabel-${post.id}`}>Color <RequiredMark /></span>
            <ColorRadios
              name={`color-${post.id}`}
              value={editing.color}
              onChange={(color) => setEditing({ ...editing, color })}
              labelledBy={`colorLabel-${post.id}`}
            />
            {editing.kind === "fixed" && <SuggestedColorNote suggestion={editSuggestion} color={editing.color} />}
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

        <button type="button" onClick={() => saveEdit()} disabled={editing.image?.uploading}>
          Save
        </button>

        <button type="button" className="secondary-button" onClick={() => { setEditing(null); setConflict(null); }}>
          Cancel
        </button>
      </div>
    );
  }

  /**
   * One post's card in the Waiting or Scheduled list.
   *
   * Usage:
   *   postCard(post, platform, { showAdded: true })  // waiting list
   *
   * Takes:
   *   post      - the post row
   *   platform  - its platform
   *   showAdded - true in the waiting list: shows "Added <date>" instead of "Scheduled: ..."
   *
   * Returns:
   *   JSX: badges (Specific Date, or type and color), the caption or the edit form, the
   *   image (or a red "No image yet"), when it is scheduled ("Waiting for a slot" when it
   *   has no time), and Edit / Remove by permission.
   */
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

        {!isEditing && (post.mediaLink ? (
          <p className="library-image">
            <img src={`${post.mediaLink}?inline=1`} alt="" loading="lazy" />
            <span>
              <strong>Image:</strong>{" "}
              <a href={post.mediaLink} target="_blank" rel="noreferrer">
                {post.mediaName}
              </a>
              {post.altText && ` (alt text: ${post.altText})`}
            </span>
          </p>
        ) : (
          <p className="error-text">No image yet{canEditPost(post) ? ". Edit the post to add one" : ""}; it can't be posted without it.</p>
        ))}

        {!showAdded && (
          <p>
            Scheduled:{" "}
            <strong>
              {fixed && post.fixedAt
                ? formatLocal(post.fixedAt, timezone)
                : post.scheduledAt
                  ? formatDateTime(post.scheduledAt, timezone)
                  : "Waiting for a slot"}
            </strong>
          </p>
        )}

        {!isEditing && (canEdit || canDelete) && (
          <div className="post-actions">
            {canEditPost(post) && (
              <button type="button" onClick={() => startEdit(post)}>
                Edit
              </button>
            )}
            {canEdit && !canEditPost(post) && <span className="field-hint">Ask a super admin to change a scheduled post.</span>}
            {canDelete && (
              <button type="button" className="remove-button" onClick={() => removePost(post)}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  /**
   * One post's card in "Failed to send": the reason (lastError), when it was due, and
   * Requeue / Remove by permission. Specific Date posts get New Date / New Time fields;
   * Requeue stays disabled until both are picked.
   *
   * Takes:
   *   post - the failed post row
   */
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
          {!canEdit
            ? "Someone who can edit posts can requeue it."
            : fixed
              ? "Choose a new date and time to requeue it."
              : "Requeueing puts it back in the library, where it fills the next empty matching slot."}
        </p>

        {fixed && canEdit && (
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
              <label htmlFor={`requeueTime-${post.id}`}>New Time ({zoneCity(timezone)})</label>
              <input
                id={`requeueTime-${post.id}`}
                type="time"
                value={picking ? requeueing.time : ""}
                onChange={(event) => setRequeueing({ date: "", ...(picking ? requeueing : {}), id: post.id, time: event.target.value })}
              />
            </div>
          </div>
        )}
        {fixed && canEdit && picking && <YourTimeHint date={requeueing.date} time={requeueing.time} timeZone={timezone} />}

        {(canEdit || canDelete) && (
          <div className="post-actions">
            {canEdit && (
              <button
                type="button"
                onClick={() => requeuePost(post)}
                disabled={fixed && !(picking && requeueing.date && requeueing.time)}
              >
                Requeue
              </button>
            )}
            {canDelete && (
              <button type="button" className="remove-button" onClick={() => removePost(post)}>
                Remove
              </button>
            )}
          </div>
        )}
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
            {platform.paused && (
              <p className="field-hint" role="note">
                Posting is paused for {platform.name}: its queued posts have no time and nothing is sent until it is
                resumed on the Platforms page. Specific Date posts whose time passes during the pause move to
                "Failed to send", to be requeued with a new date.
              </p>
            )}

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
