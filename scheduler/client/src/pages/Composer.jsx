/**
 * Compose page: write a new post and either add it to a platform's Library (it fills the
 * next matching empty slot) or schedule it on a Specific Date.
 *
 * What lives here:
 *   Composer  the page (route /compose)
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api.js";
import { formatDateTime, formatLocal, formatSlotTime, zoneCity } from "../time.js";
import { YourTimeHint } from "../components/TimeZone.jsx"; // viewer's own time
import { ColorRadios, ConflictNotice, PostTypeSelect, RequiredMark, splitFixedAt } from "../components/PostFields.jsx";
import ImageField, { imageOfMedia, imageProblem } from "../components/ImageField.jsx";
import { PreviewButton } from "../components/PostPreview.jsx";
import { saveDraft, sessionState, takeDraft, useCurrentUser } from "../currentUser.js";
import { BlackoutNotice } from "../components/BlackoutDates.jsx"; // blackout warning
import { SuggestedColorNote, useSuggestedColor } from "../components/SuggestedColor.jsx"; // color suggestion

/**
 * The Compose form: mode (Specific Date / Add to Library), platform, post type (with
 * "+ New post type"), color (Instagram/Facebook only), caption with a character count,
 * image with alt text, and for Specific Date a date, a time in the app zone, the
 * 2-hour collision notice and the blackout warning. "Preview post" opens the live preview.
 *
 * Usage:
 *   Rendered by App.jsx for the /compose route: <Composer />. The Media page's
 *   "Use in a new post" links to /compose?mediaId=ID to start with that image.
 *
 * Returns:
 *   The page section; without createPosts only a short "Your role cannot create posts".
 *
 * How it works:
 *   1. Loads the enabled platforms and the app time zone.
 *   2. Draft kept across a session timeout: the form's values are mirrored in a ref; when
 *      the page unmounts because the session ended and there is a caption or an image,
 *      they are saved (sessionStorage, this tab only). On mount, a saved draft from the
 *      same user is put back with a notice.
 *   3. ?mediaId= loads that media row (GET /api/media/:id) into the image field.
 *   4. The caption count is the trimmed caption alone, since hashtags are typed into the
 *      caption. At the platform's charLimit it turns red; over it, Submit is disabled.
 *   5. Picking a platform resets the post type to its first rotation type and, if no time
 *      was chosen, sets the time to its earliest posting time.
 *   6. Post types outside the rotation (Holiday) are Specific Date only: picking one in
 *      Library mode switches to Specific Date, and switching to Library picks a rotation
 *      type instead.
 *   7. Submit (see submit() below) validates, posts, shows where it landed and clears the
 *      form (platform, caption, image, alt text, date; mode, type, color and time stay).
 *   8. Specific Date on a platform with colors: once a date and time are chosen, the color
 *      that keeps Blue/Purple alternating is preselected (useSuggestedColor); the
 *      user can still pick the other one. The post's color shifts the later slots.
 *
 * When editing:
 *   POST /api/posts (server/src/routes/posts.js) checks everything again, including the
 *   collision window and the image rules; the checks here are only for quick feedback.
 *   Times are entered and sent in the app zone (TIMEZONE in .env), never the browser's.
 */
export default function Composer() {
  const { user, permissions } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const [platforms, setPlatforms] = useState([]);
  const [timezone, setTimezone] = useState();
  const [platformId, setPlatformId] = useState("");
  const [caption, setCaption] = useState("");
  const [image, setImage] = useState(null); // { name, previewUrl, media, uploading, error }
  const [altText, setAltText] = useState("");
  const [mode, setMode] = useState("library");
  const [postTypeId, setPostTypeId] = useState(null);
  const [color, setColor] = useState("Blue");
  const [fixedDate, setFixedDate] = useState("");
  const [fixedTime, setFixedTime] = useState("");
  const [conflict, setConflict] = useState(null); // 409 body: { error, conflict, suggestedAt }
  const [message, setMessage] = useState("");
  const [newType, setNewType] = useState(null); // name being typed for a new post type, or null when closed
  const mediaIdParam = searchParams.get("mediaId");

  // Draft kept across a session timeout (step 2 above)
  const draft = useRef(null);
  draft.current = { userId: user?.id, platformId, caption, media: image?.media ?? null, altText, mode, postTypeId, color, fixedDate, fixedTime };
  useEffect(() => {
    const saved = takeDraft("compose");
    if (saved && saved.userId === user?.id) {
      setPlatformId(saved.platformId ?? "");
      setCaption(saved.caption ?? "");
      setImage(saved.media ? imageOfMedia(saved.media) : null);
      setAltText(saved.altText ?? "");
      setMode(saved.mode ?? "library");
      setPostTypeId(saved.postTypeId ?? null);
      setColor(saved.color ?? "Blue");
      setFixedDate(saved.fixedDate ?? "");
      setFixedTime(saved.fixedTime ?? "");
      setMessage("Your unsaved post was kept while you were signed out. Check it and send it when ready.");
    }
    return () => {
      const { caption: text, media } = draft.current;
      if (sessionState.ended && (text.trim() || media)) saveDraft("compose", draft.current);
    };
  }, []);

  useEffect(() => {
    api.platforms()
      .then((all) => setPlatforms(all.filter((platform) => platform.enabled)))
      .catch((error) => setMessage(error.message));
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
  }, []);

  // ?mediaId=ID from the Media page's "Use in a new post"
  useEffect(() => {
    if (!mediaIdParam) return;
    let current = true;
    fetch(`/api/media/${encodeURIComponent(mediaIdParam)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        return res.json();
      })
      .then((media) => current && setImage(imageOfMedia(media)))
      .catch((error) => current && setMessage(`Could not load that image: ${error.message}`));
    return () => { current = false; };
  }, [mediaIdParam]);

  const platform = platforms.find((p) => p.id === Number(platformId));
  // Hashtags are part of the caption
  const postLength = caption.trim().length;
  const atLimit = Boolean(platform?.charLimit && postLength >= platform.charLimit);
  const overLimit = Boolean(platform?.charLimit && postLength > platform.charLimit);
  const postingTime = platform ? [...(platform.postingTimes ?? [])].sort()[0] : null;
  const postTypeName = platform?.postTypes?.find((type) => type.id === postTypeId)?.name;
  const colorSuggestion = useSuggestedColor({ platform, date: fixedDate, time: fixedTime, enabled: mode === "fixed", onSuggest: setColor });

  /**
   * Switches platform. Each platform has its own post types and posting times, so the
   * type resets to the platform's first rotation type, any collision notice is cleared,
   * and the time is set to its earliest posting time unless one was already chosen.
   *
   * Takes:
   *   id - the platform id from the select, as a string ("" for none)
   */
  function choosePlatform(id) {
    setPlatformId(id);
    setConflict(null);
    const next = platforms.find((p) => p.id === Number(id));
    setPostTypeId(next?.postTypes?.find((type) => type.inRotation)?.id ?? null);
    if (next && !fixedTime) setFixedTime([...(next.postingTimes ?? [])].sort()[0] ?? "");
  }

  /**
   * Adds a post type to this platform without leaving Compose (needs managePostTypes).
   *
   * Usage:
   *   The "Add" button or Enter in the "New post type" field.
   *
   * How it works:
   *   1. Does nothing without a name or a platform.
   *   2. In Library mode the type joins the monthly rotation (so slots will ask for it);
   *      in Specific Date mode it stays out of it, like Holiday.
   *   3. The server returns the whole platform; it replaces the old copy, and the new
   *      type (matched by name, any case) is selected.
   */
  async function addPostType() {
    const name = newType?.trim();
    if (!name || !platform) return;
    try {
      const saved = await api.addPostType(platform.id, { name, inRotation: mode === "library" });
      setPlatforms((current) => current.map((p) => (p.id === saved.id ? saved : p)));
      setPostTypeId(saved.postTypes.find((type) => type.name.toLowerCase() === name.toLowerCase())?.id ?? null);
      setNewType(null);
      setMessage(`Added the "${name}" post type to ${platform.name}.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  /**
   * Selects a post type. A type outside the rotation (Holiday) can't wait in the library,
   * so picking one in Library mode switches to Specific Date.
   *
   * Takes:
   *   id - the post type id (number)
   */
  function choosePostType(id) {
    setPostTypeId(id);
    const type = platform?.postTypes?.find((t) => t.id === id);
    if (type && !type.inRotation && mode === "library") setMode("fixed");
  }

  // Switching to Library with a non-rotation type picks a rotation type
  useEffect(() => {
    if (mode !== "library" || !platform) return;
    const current = platform.postTypes?.find((type) => type.id === postTypeId);
    if (!current?.inRotation) setPostTypeId(platform.postTypes?.find((type) => type.inRotation)?.id ?? null);
  }, [mode, platform, postTypeId]);

  async function handleSubmit(event) {
    event.preventDefault();
    await submit(false);
  }

  /**
   * Validates and sends the post.
   *
   * Usage:
   *   submit(false)  // the form's Submit button
   *   submit(true)   // "Schedule anyway" in the collision notice
   *
   * Takes:
   *   force - true to schedule even when another Specific Date post is within the
   *           collision window
   *
   * Returns:
   *   Nothing; shows a message either way.
   *
   * How it works:
   *   1. Checks in order: platform and caption, the image (imageProblem in
   *      ImageField.jsx), post type, and for Specific Date the date and time.
   *   2. Sends { platformId, caption, mediaId, altText, kind, postTypeId, color, fixedAt? }.
   *      color is null on platforms without colors. fixedAt is "YYYY-MM-DDTHH:MM" in the
   *      app zone.
   *   3. A 409 with a conflict body shows the collision notice (with the suggested time);
   *      other errors show their message.
   *   4. On success says where it landed: the Specific Date time (that day's library post
   *      went back to the library), or the slot it fills, or that it waits for the next
   *      empty slot of its type and color. Then clears the form.
   */
  async function submit(force) {
    if (!platform || !caption.trim()) {
      setMessage("Please select a platform and enter a caption.");
      return;
    }
    const missingImage = imageProblem(image);
    if (missingImage) {
      setMessage(missingImage);
      return;
    }
    if (!postTypeId) {
      setMessage("Please choose a post type.");
      return;
    }
    if (mode === "fixed" && (!fixedDate || !fixedTime)) {
      setMessage("Please choose a date and a time.");
      return;
    }

    const schedule = mode === "library"
      ? { kind: "library", postTypeId, color: platform.usesColors ? color : null }
      : { kind: "fixed", fixedAt: `${fixedDate}T${fixedTime}`, postTypeId, color: platform.usesColors ? color : null };

    let post;
    try {
      post = await api.createPost({
        platformId: platform.id,
        caption,
        mediaId: image.media.id,
        altText,
        ...schedule,
        ...(force ? { force: true } : {}),
      });
    } catch (error) {
      if (error.status === 409 && error.body?.conflict) {
        setConflict(error.body);
        setMessage("");
      } else {
        setMessage(error.message);
      }
      return;
    }

    if (post.kind === "fixed") {
      setMessage(`Scheduled on ${platform.name} for ${formatLocal(post.fixedAt, timezone)}. That day's library post went back to the library.`);
    } else {
      const slotLabel = `${post.postTypeName ?? postTypeName}${post.color ? ` · ${post.color}` : ""}`;
      setMessage(
        post.scheduledAt
          ? `Added to the ${platform.name} library (${slotLabel}). It fills the slot on ${formatDateTime(post.scheduledAt, timezone)}.`
          : `Added to the ${platform.name} library (${slotLabel}). It waits for the next empty ${slotLabel} slot.`
      );
    }

    setConflict(null);
    setPlatformId("");
    setCaption("");
    setImage(null);
    setAltText("");
    setFixedDate("");
  }

  /**
   * Puts the collision notice's suggested time into the date and time fields.
   *
   * Takes:
   *   suggestedAt - "YYYY-MM-DDTHH:MM" in the app zone, from the 409 body
   */
  function applySuggested(suggestedAt) {
    const { date, time } = splitFixedAt(suggestedAt);
    setFixedDate(date);
    setFixedTime(time);
    setConflict(null);
  }

  if (!permissions.createPosts) {
    return (
      <section>
        <h1>Compose</h1>
        <p>Your role cannot create posts. Ask a super admin if you need to.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Compose</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <span className="field-label" id="whenLabel">When to post</span>
          <div className="mode-toggle" role="group" aria-labelledby="whenLabel">
            <button
              type="button"
              className={mode === "fixed" ? "active-view" : ""}
              aria-pressed={mode === "fixed"}
              onClick={() => { setMode("fixed"); setConflict(null); }}
            >
              Specific Date
            </button>
            <button
              type="button"
              className={mode === "library" ? "active-view" : ""}
              aria-pressed={mode === "library"}
              onClick={() => { setMode("library"); setConflict(null); }}
            >
              Add to Library
            </button>
          </div>
          <p className="field-hint required-legend">
            Fields marked <span className="required-star" aria-hidden="true">*</span> are required.
          </p>
        </div>

        <div>
          <label htmlFor="platform">Platform <RequiredMark /></label>

          <select
            id="platform"
            value={platformId}
            onChange={(event) => choosePlatform(event.target.value)}
            required
            aria-required="true"
          >
            <option value="">Select a platform</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="postType">Post Type <RequiredMark /></label>
          {platform ? (
            <PostTypeSelect id="postType" platform={platform} value={postTypeId} onChange={choosePostType} />
          ) : (
            <select id="postType" disabled aria-required="true">
              <option>Select a platform first</option>
            </select>
          )}
          {platform && permissions.managePostTypes && (newType === null ? (
            <button type="button" className="link-button" onClick={() => setNewType("")}>
              + New post type
            </button>
          ) : (
            <div className="post-type-add">
              <input
                type="text"
                aria-label="New post type name"
                placeholder={`New ${platform.name} post type`}
                value={newType}
                onChange={(event) => setNewType(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); addPostType(); }
                }}
                autoFocus
              />
              <button type="button" onClick={addPostType}>Add</button>
              <button type="button" className="secondary-button" onClick={() => setNewType(null)}>Cancel</button>
              <span className="field-hint">
                {mode === "library" ? "Joins the monthly rotation." : "Specific Date only, like Holiday."} Manage types on the Platforms page.
              </span>
            </div>
          ))}
          {mode === "library" && (
            <p className="field-hint">
              No date: it fills the next empty slot with the same
              {platform && !platform.usesColors ? " type" : " color and type"}.
              {platform && !platform.usesColors && ` ${platform.name} posts have no color.`}
            </p>
          )}
        </div>

        {platform?.usesColors && (
          <div>
            <span className="field-label" id="composeColorLabel">Color <RequiredMark /></span>
            <ColorRadios name="composeColor" value={color} onChange={setColor} labelledBy="composeColorLabel" />
            <p className="field-hint">The color of the post's graphic.</p>
            {mode === "fixed" && <SuggestedColorNote suggestion={colorSuggestion} color={color} />}
          </div>
        )}

        <div>
          <label htmlFor="caption">Caption <RequiredMark /></label>

          <textarea
            id="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Write your post caption here, hashtags included..."
            rows="6"
            required
            aria-required="true"
            aria-describedby="captionCount"
          />

          <p id="captionCount" className={atLimit ? "error-text" : "field-hint"}>
            Characters: {postLength}
            {platform?.charLimit ? ` / ${platform.charLimit}` : ""}
            {overLimit ? ` (${postLength - platform.charLimit} over ${platform.name}'s limit)` : ""}
            {atLimit && !overLimit ? " (at the limit)" : ""}
          </p>
        </div>

        <div>
          <ImageField
            idPrefix="compose"
            image={image}
            setImage={setImage}
            altText={altText}
            setAltText={setAltText}
            platformId={platformId}
            removable
          />
        </div>

        {mode === "fixed" && (
          <div>
            <div className="date-time-row">
              <div>
                <label htmlFor="fixedDate">Date <RequiredMark /></label>
                <input
                  id="fixedDate"
                  type="date"
                  value={fixedDate}
                  onChange={(event) => { setFixedDate(event.target.value); setConflict(null); }}
                  required
                  aria-required="true"
                />
              </div>
              <div>
                <label htmlFor="fixedTime">Time ({zoneCity(timezone)}) <RequiredMark /></label>
                <input
                  id="fixedTime"
                  type="time"
                  value={fixedTime}
                  onChange={(event) => { setFixedTime(event.target.value); setConflict(null); }}
                  required
                  aria-required="true"
                />
              </div>
            </div>
            <YourTimeHint date={fixedDate} time={fixedTime} timeZone={timezone} />
            <p className="field-hint">
              Fixed: automation never moves it. That day's library post goes back to the library.
              {postingTime && ` ${platform.name} usually posts at ${formatSlotTime(fixedDate, postingTime, timezone)}.`}
            </p>
            <BlackoutNotice platformId={platform?.id} date={fixedDate} />

            {conflict && (
              <ConflictNotice conflict={conflict} onUseSuggested={applySuggested} onForce={() => submit(true)} />
            )}
          </div>
        )}

        <div className="compose-actions">
          <button type="submit" disabled={overLimit || image?.uploading}>
            {mode === "fixed" ? "Schedule on this Date" : "Add to Library"}
          </button>
          {/* How it will look on the chosen platform, in a dialog */}
          <PreviewButton platform={platform} caption={caption} image={image} altText={altText} />
        </div>

        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
