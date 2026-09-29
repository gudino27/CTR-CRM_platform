import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatDateTime, priorityLabels } from "../time.js";

export default function Composer() {
  const [platforms, setPlatforms] = useState([]);
  const [timezone, setTimezone] = useState();
  const [platformId, setPlatformId] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [image, setImage] = useState(null); // { file, previewUrl, media, uploading, error }
  const [altText, setAltText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [priority, setPriority] = useState("0");
  const [overrideDate, setOverrideDate] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef(null);

  useEffect(() => {
    api.platforms()
      .then((all) => setPlatforms(all.filter((platform) => platform.enabled)))
      .catch((error) => setMessage(error.message));
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
  }, []);

  // Free the preview's object URL when the image changes or the page closes
  useEffect(() => () => image && URL.revokeObjectURL(image.previewUrl), [image?.previewUrl]);

  const platform = platforms.find((p) => p.id === Number(platformId));
  const postLength = caption.trim().length + (hashtags.trim() ? hashtags.trim().length + 2 : 0);
  const atLimit = Boolean(platform?.charLimit && postLength >= platform.charLimit);
  const overLimit = Boolean(platform?.charLimit && postLength > platform.charLimit);
  const postingTime = platform ? [...platform.postingTimes].sort()[0] : null;

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

    try {
      const post = await api.createPost({
        platformId: platform.id,
        caption,
        hashtags,
        mediaId: image?.media.id ?? null,
        altText,
        priority: Number(priority),
        // Next posts always go out the next day, so they carry no override
        overrideDate: priority !== "2" && overrideDate ? overrideDate : null,
      });

      setMessage(
        post.scheduledAt
          ? `Post added to the ${platform.name} queue for ${formatDateTime(post.scheduledAt, timezone)}`
          : `Post added to the ${platform.name} queue. No posting slot is available yet`
      );
    } catch (error) {
      setMessage(error.message);
      return;
    }

    setPlatformId("");
    setCaption("");
    setHashtags("");
    removeImage();
    setPriority("0");
    setOverrideDate("");
  }

  return (
    <section>
      <h1>Compose</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="platform">Platform</label>

          <select
            id="platform"
            value={platformId}
            onChange={(event) => setPlatformId(event.target.value)}
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

        <div>
          <label htmlFor="priority">Priority</label>

          <select
            id="priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value)
            }
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="overrideDate">
            Override Date (Optional)
          </label>

          <input
            id="overrideDate"
            type="date"
            value={overrideDate}
            onChange={(event) =>
              setOverrideDate(event.target.value)
            }
            disabled={priority === "2"}
          />

          <p className="field-hint">
            Leave empty to use the next open slot
            {postingTime && ` ${platform.name} posts at ${postingTime}.`}
          </p>
        </div>

        <button type="submit" disabled={overLimit || image?.uploading}>
          Add to Queue
        </button>

        {message && <p>{message}</p>}
      </form>
    </section>
  );
}