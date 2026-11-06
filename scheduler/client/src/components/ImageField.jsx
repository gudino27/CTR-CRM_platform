/**
 * The post image field: drop zone or media library, the original next to the stored JPEG,
 * rotate buttons to fix a sideways picture, the platform's format warnings, and alt text.
 * Used by Compose, the Library edit form and the Calendar panels. Every post needs an image.
 *
 * What lives here: ImageField (the field), imageOfPost / imageOfMedia (make the `image`
 * value it works with), imageProblem (the check before saving), and the small Preview.
 *
 * The `image` value the forms keep in state:
 *   { name, previewUrl (a blob: URL for a local file, or thumbnailUrl), media (the stored
 *     media row, null until uploaded), uploading (true while uploading), error (upload message) }
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useCurrentUser } from "../currentUser.js";
import MediaPicker, { thumbnailUrl } from "./MediaPicker.jsx";
import { RequiredMark } from "./PostFields.jsx";

// File type words for the details line
const typeNames = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };
const typeName = (mimeType) => typeNames[mimeType] ?? mimeType ?? "Unknown type";

/** "512 bytes", "240 KB" or "3.4 MB"; "" when unknown. */
function fileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "JPEG · 1080 × 1350 · 240 KB", leaving out what is unknown. */
function details({ mimeType, width, height, sizeBytes }) {
  return [typeName(mimeType), width && height ? `${width} × ${height}` : "", fileSize(sizeBytes)].filter(Boolean).join(" · ");
}

/**
 * The image a post already has, in the shape ImageField works with.
 *
 * Usage:
 *   const [image, setImage] = useState(imageOfPost(post));   (Library, Calendar)
 *
 * Takes:
 *   post - a post row with mediaId, mediaLink and mediaName
 *
 * Returns:
 *   The image value (media holds only { id, link }; ImageField fetches the rest), or null
 *   when the post has no image.
 *
 * How it works:
 *   The preview comes through the app (thumbnailUrl), because mediaLink can be Drive's
 *   viewer page.
 */
export function imageOfPost(post) {
  if (!post?.mediaId) return null;
  const link = post.mediaLink ?? `/api/media/${post.mediaId}/file`;
  return { name: post.mediaName ?? "Current image", previewUrl: thumbnailUrl({ id: post.mediaId }), media: { id: post.mediaId, link }, uploading: false, error: "" };
}

/**
 * An image from GET /api/media or the media library, in the shape ImageField works with.
 *
 * Usage:
 *   setImage(imageOfMedia(media));
 *
 * Takes:
 *   media - a full media row
 */
export function imageOfMedia(media) {
  return { name: media.name, previewUrl: thumbnailUrl(media), media, uploading: false, error: "" };
}

/**
 * Checks the image is ready to save: there is one, it finished uploading, and it uploaded.
 *
 * Usage:
 *   const problem = imageProblem(image); if (problem) return setMessage(problem);
 *
 * Returns:
 *   A message for the user, or "" when ready.
 */
export function imageProblem(image) {
  if (!image) return "Please add an image. Every post needs one.";
  if (image.uploading) return "Please wait for the image to finish uploading.";
  if (!image.media) return "The image did not upload. Choose another one.";
  return "";
}

/**
 * The image preview with its details.
 *
 * Takes:
 *   image   - the image value
 *   media   - the stored row merged with the fetched details (or null before upload)
 *   altText - used as the stored image's alt text
 *
 * Returns:
 *   When the file was uploaded here and converted: the file as chosen next to the JPEG the
 *   server stored ("what gets posted"). Otherwise one preview, with notes on conversion and
 *   rotation (EXIF turn-upright, degrees turned since upload).
 */
function Preview({ image, media, altText }) {
  const conversion = media?.conversion;
  const storedUrl = media ? thumbnailUrl(media) : image.previewUrl;
  const isLocal = image.previewUrl?.startsWith("blob:");

  if (media && conversion?.converted && isLocal) {
    return (
      <div className="image-compare">
        <figure>
          <img className="image-checker" src={image.previewUrl} alt="" />
          <figcaption>
            <strong>Original</strong>
            <span>{details({ mimeType: conversion.originalMimeType, width: conversion.originalWidth, height: conversion.originalHeight, sizeBytes: conversion.originalSizeBytes })}</span>
          </figcaption>
        </figure>
        <figure>
          <img src={storedUrl} alt={altText || image.name} />
          <figcaption>
            <strong>{conversion.originalMimeType === "image/jpeg" ? "Saved JPEG (what gets posted)" : "Converted JPEG (what gets posted)"}</strong>
            <span>{details(conversion)}</span>
            {conversion.rotatedFromExif && <span>Turned upright using the camera's orientation setting.</span>}
            {conversion.rotation > 0 && <span>Rotated {conversion.rotation}° to the right.</span>}
          </figcaption>
        </figure>
      </div>
    );
  }

  const info = conversion ?? (media?.mimeType ? media : null);
  return (
    <div className="image-compare image-compare-single">
      <figure>
        <img src={media && !isLocal ? storedUrl : image.previewUrl} alt={altText || image.name} />
        <figcaption>
          <strong>{image.name}</strong>
          {info && <span>{details(info)}</span>}
          {conversion && !conversion.converted && <span>Already a JPEG, so it is posted as it is.</span>}
          {conversion?.converted && !isLocal && conversion.originalMimeType !== "image/jpeg" && (
            <span>Converted from {typeName(conversion.originalMimeType)} when it was uploaded.</span>
          )}
          {conversion?.rotatedFromExif && !isLocal && <span>Turned upright using the camera's orientation setting.</span>}
          {conversion?.rotation > 0 && !isLocal && <span>Rotated {conversion.rotation}° to the right since it was uploaded.</span>}
        </figcaption>
      </figure>
    </div>
  );
}

/**
 * The rotate buttons, in the order shown. Degrees are clockwise: 270 turns it left.
 *
 * When editing:
 *   Rotation re-saves the stored JPEG on the server (same file, same link), so it applies to
 *   every post using the image that hasn't gone out yet; published posts keep a copy of the
 *   version they went out with. The server accepts only 90, 180 and 270.
 */
const ROTATIONS = [
  { degrees: 270, label: "Rotate left" },
  { degrees: 90, label: "Rotate right" },
  { degrees: 180, label: "Turn upside down" },
];

/**
 * The image field of a post form.
 *
 * Usage:
 *   <ImageField idPrefix="compose" image={image} setImage={setImage} altText={altText}
 *     setAltText={setAltText} platformId={platformId} removable />   (Composer)
 *
 * Takes:
 *   idPrefix   - unique per form, for the element ids
 *   image      - the image value (see the top of this file), or null
 *   setImage   - a state setter (it is called with a function, since uploads finish later)
 *   altText, setAltText - the alt text and its setter
 *   platformId - for the format checks; no checks without it
 *   removable  - shows "Remove image" (Compose only; a saved post can swap its image but not
 *                drop it). Default false.
 *
 * Returns:
 *   The preview, notices for archived or deleted images, rotate buttons, the drop zone and
 *   file input, upload status, format warnings, "Choose from media library" with the picker,
 *   and the alt text input once there is an image.
 *
 * How it works:
 *   - A chosen or dropped file uploads at once (POST /api/media), so saving only has to send
 *     the media id; the local file shows meanwhile. A late answer for an older file is ignored.
 *   - The image's current row is fetched from GET /api/media/:id, since a post's image
 *     arrives with only id and link. What the form passed wins (it is newer after a
 *     rotation); the fetched row fills in the rest.
 *   - GET /api/media/:id/check?platformId= lists the platform's format, size or shape
 *     warnings; it runs again when the image, its hash (after a rotation) or the platform changes.
 *   - Rotating keeps the form's image, with the new size and hash (the hash refreshes the preview).
 *   - The local preview's object URL is freed when the image changes or the form closes.
 *
 * When editing:
 *   Uploading and rotating need the uploadMedia permission (the server checks it too);
 *   anyone can choose from the media library. The warnings' rules are imageRules in
 *   server/src/settings.js. The file input's accepted types (JPEG, PNG, WebP) are the ones
 *   the server reads; keep them in step.
 */
export default function ImageField({ idPrefix, image, setImage, altText, setAltText, platformId, removable = false }) {
  const [dragging, setDragging] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [stored, setStored] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState("");
  const fileInput = useRef(null);
  const { permissions } = useCurrentUser();
  const mediaId = image?.media?.id ?? null;

  const media = image?.media ? { ...stored, ...image.media } : null;
  const canRotate = Boolean(permissions.uploadMedia && media && !media.deletedAt && !image.uploading);

  useEffect(() => {
    setStored(null);
    setRotateError("");
    if (!mediaId) return;
    let current = true;
    api.media(mediaId)
      .then((row) => current && setStored(row))
      .catch(() => {});
    return () => { current = false; };
  }, [mediaId]);

  useEffect(() => () => {
    if (image?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  }, [image?.previewUrl]);

  useEffect(() => {
    if (!image?.media || !platformId) return setWarnings([]);
    let current = true;
    fetch(`/api/media/${image.media.id}/check?platformId=${platformId}`)
      .then((res) => (res.ok ? res.json() : { warnings: [] }))
      .then((result) => current && setWarnings(result.warnings ?? []))
      .catch(() => current && setWarnings([]));
    return () => { current = false; };
  }, [image?.media?.id, image?.media?.sha256, platformId]);

  async function rotate(degrees) {
    setRotating(true);
    setRotateError("");
    try {
      const turned = await api.rotateMedia(mediaId, degrees);
      setStored(turned);
      setImage((current) => (current?.media?.id === turned.id ? { ...current, media: { ...current.media, ...turned } } : current));
    } catch (error) {
      setRotateError(error.message);
    } finally {
      setRotating(false);
    }
  }

  async function chooseFile(file) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setImage({ name: file.name, previewUrl, media: null, uploading: true, error: "" });
    try {
      const media = await api.uploadMedia(file);
      setImage((current) => (current?.previewUrl === previewUrl ? { ...current, media, uploading: false } : current));
    } catch (error) {
      setImage((current) => (current?.previewUrl === previewUrl ? { ...current, uploading: false, error: error.message } : current));
    }
  }

  function chooseFromLibrary(media) {
    setImage(imageOfMedia(media));
    setShowLibrary(false);
  }

  function remove() {
    setImage(null);
    setAltText("");
    if (fileInput.current) fileInput.current.value = "";
  }

  const labelId = `${idPrefix}-image-label`;

  return (
    <div className="image-field">
      <span className="field-label" id={labelId}>Image <RequiredMark /></span>

      {image && <Preview image={image} media={media} altText={altText} />}

      {media?.archivedAt && (media.archiveNote ? (
        <p className="image-notice">
          {media.archiveNote}: the image as this post went out with it, kept for history.
        </p>
      ) : (
        <p className="image-notice">
          The full-quality image was deleted for good. Only a low-resolution copy is kept for history.
        </p>
      ))}
      {media?.deletedAt && !media.archivedAt && (
        <p className="image-notice">This image is in Recently deleted on the Media page. Choose another one for a new post.</p>
      )}

      {canRotate && (
        <div className="image-rotate" role="group" aria-label="Rotate the image">
          {ROTATIONS.map(({ degrees, label }) => (
            <button key={degrees} type="button" className="secondary-button" onClick={() => rotate(degrees)} disabled={rotating}>
              {label}
            </button>
          ))}
          <span className="image-rotate-hint" role="status">
            {rotating
              ? "Rotating..."
              : "Is it the wrong way up? Rotating changes this image for posts that haven't gone out yet. Posts that were already published keep the original."}
          </span>
        </div>
      )}
      {rotateError && <p className="error-text">{rotateError}</p>}

      {/* Uploading needs the uploadMedia permission; anyone can choose from the media library */}
      {permissions.uploadMedia && (
        <>
        <div
          className={`drop-zone${image ? " drop-zone-compact" : ""}${dragging ? " drop-zone-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(event.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          aria-labelledby={labelId}
          aria-describedby={`${idPrefix}-image-hint`}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInput.current?.click();
            }
          }}
        >
          <p id={`${idPrefix}-image-hint`}>
            {image
              ? "Drag a different image here, or click to choose another"
              : "Drag an image here, or click to choose one (JPEG, PNG or WebP). It is saved as a JPEG."}
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        </>
      )}

      {image && (image.uploading || image.error) && (
        <p role="status">
          {image.uploading && `Uploading and converting ${image.name}...`}
          {image.error && <span className="error-text">{image.error}</span>}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="error-text">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <div className="image-actions">
        <button type="button" className="secondary-button" onClick={() => setShowLibrary((open) => !open)}>
          {showLibrary ? "Hide media library" : "Choose from media library"}
        </button>
        {removable && image && (
          <button type="button" className="secondary-button" onClick={remove}>
            Remove image
          </button>
        )}
      </div>

      {showLibrary && <MediaPicker onSelect={chooseFromLibrary} selectedId={image?.media?.id ?? null} />}

      {image && (
        <div className="image-alt">
          <label htmlFor={`${idPrefix}-altText`}>
            Alt Text <span className="optional-text">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-altText`}
            type="text"
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            placeholder="Describe the image for people using screen readers"
          />
        </div>
      )}
    </div>
  );
}
