import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatDateTime, formatLocal } from "../time.js";
import { ColorRadios, ConflictNotice, PostTypeSelect, splitFixedAt } from "../components/PostFields.jsx";
import MediaPicker, { thumbnailUrl } from "../components/MediaPicker.jsx";

export default function Composer() {
  const [platforms, setPlatforms] = useState([]);
  const [timezone, setTimezone] = useState();
  const [platformId, setPlatformId] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [image, setImage] = useState(null); // { file, previewUrl, media, uploading, error }
  const [altText, setAltText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [imageWarnings, setImageWarnings] = useState([]);
  // "library" fills the next matching empty slot; "fixed" is a Specific Date
  const [mode, setMode] = useState("library");
  const [postTypeId, setPostTypeId] = useState(null);
  const [color, setColor] = useState("Blue");
  const [fixedDate, setFixedDate] = useState("");
  const [fixedTime, setFixedTime] = useState("");
  const [conflict, setConflict] = useState(null); // 409 body: { error, conflict, suggestedAt }
  const [message, setMessage] = useState("");
  const [newType, setNewType] = useState(null); // name being typed for a new post type, or null when closed
  const fileInput = useRef(null);

  useEffect(() => {
    api.platforms()
      .then((all) => setPlatforms(all.filter((platform) => platform.enabled)))
      .catch((error) => setMessage(error.message));
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
  }, []);

  // Free the preview's object URL when the image changes or the page closes
  // (only local files have one; library images use their server link)
  useEffect(() => () => {
    if (image?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  }, [image?.previewUrl]);

  // Warn when the image breaks the chosen platform's format, size or shape rules
  useEffect(() => {
    if (!image?.media || !platformId) return setImageWarnings([]);
    let current = true;
    fetch(`/api/media/${image.media.id}/check?platformId=${platformId}`)
      .then((res) => (res.ok ? res.json() : { warnings: [] }))
      .then((result) => current && setImageWarnings(result.warnings ?? []))
      .catch(() => current && setImageWarnings([]));
    return () => { current = false; };
  }, [image?.media?.id, platformId]);

  const platform = platforms.find((p) => p.id === Number(platformId));
  const postLength = caption.trim().length + (hashtags.trim() ? hashtags.trim().length + 2 : 0);
  const atLimit = Boolean(platform?.charLimit && postLength >= platform.charLimit);
  const overLimit = Boolean(platform?.charLimit && postLength > platform.charLimit);
  const postingTime = platform ? [...platform.postingTimes].sort()[0] : null;
  const postTypeName = platform?.postTypes?.find((type) => type.id === postTypeId)?.name;

  // A new platform has its own post types and posting time
  function choosePlatform(id) {
    setPlatformId(id);
    setConflict(null);
    const next = platforms.find((p) => p.id === Number(id));
    setPostTypeId(next?.postTypes?.find((type) => type.inRotation)?.id ?? null);
    if (next && !fixedTime) setFixedTime([...next.postingTimes].sort()[0] ?? "");
  }

  // Adds a post type to this platform without leaving Compose. In Library mode it joins the
  // monthly rotation (so slots will ask for it); in Specific Date mode it stays out of it, like Holiday.
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

  // A type outside the rotation (Holiday) can't wait in the library, so picking one switches to Specific Date
  function choosePostType(id) {
    setPostTypeId(id);
    const type = platform?.postTypes?.find((t) => t.id === id);
    if (type && !type.inRotation && mode === "library") setMode("fixed");
  }

  // Holiday-style types are only for Specific Date posts; switching to Library picks a rotation type
  useEffect(() => {
    if (mode !== "library" || !platform) return;
    const current = platform.postTypes?.find((type) => type.id === postTypeId);
    if (!current?.inRotation) setPostTypeId(platform.postTypes?.find((type) => type.inRotation)?.id ?? null);
  }, [mode, platform, postTypeId]);

  // Uploads as soon as an image is chosen, so submit only has to send the media id
  async function chooseImage(file) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setImage({ file, previewUrl, media: null, uploading: true, error: "" });

    try {
      const media = await api.uploadMedia(file);
      setImage((current) => current?.previewUrl === previewUrl ? { ...current, media, uploading: false } : current);
    } catch (error) {
      setImage((current) => current?.previewUrl === previewUrl ? { ...current, uploading: false, error: error.message } : current);
    }
  }

  function chooseFromLibrary(media) {
    setImage({ file: { name: media.name }, previewUrl: thumbnailUrl(media), media, uploading: false, error: "" });
    setShowLibrary(false);
  }

  function removeImage() {
    setImage(null);
    setAltText("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    chooseImage(event.dataTransfer.files?.[0]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await submit(false);
  }

  async function submit(force) {
    if (!platform || !caption.trim()) {
      setMessage("Please select a platform and enter a caption.");
      return;
    }
    if (image?.uploading) {
      setMessage("Please wait for the image to finish uploading.");
      return;
    }
    if (image && !image.media) {
      setMessage("The image did not upload. Remove it or choose another.");
      return;
    }
    if (mode === "library" && !postTypeId) {
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
        hashtags,
        mediaId: image?.media.id ?? null,
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
      setMessage(`Scheduled on ${platform.name} for ${formatLocal(post.fixedAt)}. That day's library post went back to the library.`);
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
    setHashtags("");
    removeImage();
    setFixedDate("");
  }

  function applySuggested(suggestedAt) {
    const { date, time } = splitFixedAt(suggestedAt);
    setFixedDate(date);
    setFixedTime(time);
    setConflict(null);
  }

  return (
    <section>
      <h1>Compose</h1>

      <form onSubmit={handleSubmit}>
        <div className="mode-toggle" role="group" aria-label="When to post">
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

        <div>
          <label htmlFor="platform">Platform</label>

          <select
            id="platform"
            value={platformId}
            onChange={(event) => choosePlatform(event.target.value)}
            required
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
          <label htmlFor="caption">Caption</label>

          <textarea
            id="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Write your post caption here..."
            rows="6"
            required
          />

          <p className={atLimit ? "error-text" : undefined}>
            Characters (with hashtags): {postLength}
            {platform?.charLimit ? ` / ${platform.charLimit}` : ""}
            {overLimit ? ` (${postLength - platform.charLimit} over ${platform.name}'s limit)` : ""}
            {atLimit && !overLimit ? " (at the limit)" : ""}
          </p>
        </div>

        <div>
          <label htmlFor="hashtags">Hashtags</label>

          <input
            id="hashtags"
            type="text"
            value={hashtags}
            onChange={(event) => setHashtags(event.target.value)}
            placeholder="#volunteer #community"
          />
        </div>

        <div>
          <label htmlFor="image">Image</label>

          <div
            className={`drop-zone${dragging ? " drop-zone-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
            }}
          >
            {image ? (
              <img className="drop-zone-preview" src={image.previewUrl} alt={altText || image.file.name} />
            ) : (
              <p>Drag an image here, or click to choose one (JPEG, PNG or WebP)</p>
            )}
          </div>

          <input
            id="image"
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => chooseImage(event.target.files?.[0])}
          />

          {image && (
            <p>
              {image.uploading && `Uploading ${image.file.name}...`}
              {image.media && `Uploaded ${image.file.name}.`}
              {image.error && <span className="error-text">{image.error}</span>}{" "}
              <button type="button" onClick={removeImage}>
                Remove image
              </button>
            </p>
          )}

          {imageWarnings.length > 0 && (
            <ul className="error-text">
              {imageWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}

          <button type="button" onClick={() => setShowLibrary((open) => !open)}>
            {showLibrary ? "Hide media library" : "Choose from media library"}
          </button>

          {showLibrary && <MediaPicker onSelect={chooseFromLibrary} selectedId={image?.media?.id ?? null} />}
        </div>

        {image && (
          <div>
            <label htmlFor="altText">Alt Text</label>

            <input
              id="altText"
              type="text"
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              placeholder="Describe the image for people using screen readers"
            />
          </div>
        )}

        {platform?.usesColors && (
          <div>
            <span className="field-label">Color</span>
            <ColorRadios name="composeColor" value={color} onChange={setColor} />
          </div>
        )}

        <div>
          <label htmlFor="postType">Post Type</label>
          {platform ? (
            <PostTypeSelect id="postType" platform={platform} value={postTypeId} onChange={choosePostType} />
          ) : (
            <select id="postType" disabled>
              <option>Select a platform first</option>
            </select>
          )}
          {platform && (newType === null ? (
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
              <button type="button" onClick={() => setNewType(null)}>Cancel</button>
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

        {mode === "fixed" && (
          <div>
            <div className="date-time-row">
              <div>
                <label htmlFor="fixedDate">Date</label>
                <input
                  id="fixedDate"
                  type="date"
                  value={fixedDate}
                  onChange={(event) => { setFixedDate(event.target.value); setConflict(null); }}
                  required
                />
              </div>
              <div>
                <label htmlFor="fixedTime">Time</label>
                <input
                  id="fixedTime"
                  type="time"
                  value={fixedTime}
                  onChange={(event) => { setFixedTime(event.target.value); setConflict(null); }}
                  required
                />
              </div>
            </div>
            <p className="field-hint">
              Fixed: automation never moves it. That day's library post goes back to the library.
              {postingTime && ` ${platform.name} usually posts at ${postingTime}.`}
            </p>

            {conflict && (
              <ConflictNotice conflict={conflict} onUseSuggested={applySuggested} onForce={() => submit(true)} />
            )}
          </div>
        )}

        <button type="submit" disabled={overLimit || image?.uploading}>
          {mode === "fixed" ? "Schedule on this Date" : "Add to Library"}
        </button>

        {message && <p>{message}</p>}
      </form>
    </section>
  );
}