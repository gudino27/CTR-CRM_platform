/**
 * A live, approximate look at how a post will show in the platform's feed: the account,
 * the image cropped like that feed, and the caption cut at the "... more" point.
 * Used by Compose and the Library edit form through PreviewButton. It only reads what the
 * form already has (no server calls), and it is hidden from screen readers so the form is
 * not read twice.
 *
 * The feed table (caption cut-offs per device, crop shapes, grid tile, caption position,
 * account names) lives in settings.js as previewFeeds; previewOtherFeed is for any other
 * platform. Change the numbers there, not here.
 */
import { useRef, useState } from "react";
import logo from "../assets/ctr-logo.png";
import { thumbnailUrl } from "./MediaPicker.jsx";
import { previewFeeds, previewOtherFeed } from "../settings.js";
import "../preview.css";

/**
 * The feed's frame shape for an image.
 *
 * Usage:
 *   frameRatio({ width: 1080, height: 1920 }, previewFeeds.instagram)   // 0.8 (4:5)
 *
 * Takes:
 *   size - { width, height } of the image, or null while unknown
 *   feed - a previewFeeds entry (uses tallest and widest)
 *
 * Returns:
 *   width / height to crop to (tallest when the image is taller, widest when it is wider),
 *   or null to show it at its own shape (within the limits, or size unknown).
 */
function frameRatio(size, { tallest, widest }) {
  if (!size?.width || !size?.height) return null;
  const ratio = size.width / size.height;
  if (tallest && ratio < tallest) return tallest;
  if (widest && ratio > widest) return widest;
  return null; // within the limits: shown uncropped
}

/**
 * The caption as the feed shows it before "... more".
 *
 * Usage:
 *   cutCaption(caption, feed, "phone")   // { shown, cut }
 *
 * Takes:
 *   text   - the caption
 *   feed   - a previewFeeds entry (uses chars per device and lines)
 *   device - "phone" or "computer"
 *
 * Returns:
 *   { shown (the visible text), cut (true when "... more" should follow) }.
 *
 * How it works:
 *   Trailing spaces go first; then the line limit; then the character limit. Characters are
 *   counted with Array.from, so an emoji counts as one, like the platforms do. A cut caption
 *   loses trailing spaces again so "... more" sits right after the last word.
 */
function cutCaption(text, { chars: perDevice, lines }, device) {
  const chars = perDevice?.[device] ?? null;
  let shown = text.trimEnd();
  let cut = false;
  if (lines) {
    const kept = shown.split("\n");
    if (kept.length > lines) {
      shown = kept.slice(0, lines).join("\n");
      cut = true;
    }
  }
  const letters = Array.from(shown);
  if (chars && letters.length > chars) {
    shown = letters.slice(0, chars).join("");
    cut = true;
  }
  return { shown: cut ? shown.trimEnd() : shown, cut };
}

/**
 * The caption with hashtags in the link color, everything else as written (line breaks are
 * kept by the CSS).
 *
 * Returns:
 *   An array of strings and <span className="preview-hashtag"> elements for JSX.
 *
 * How it works:
 *   Splitting on a capturing pattern puts the hashtags at the odd positions. A hashtag is
 *   "#" followed by letters, digits or "_" in any language.
 */
function withHashtags(text) {
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) =>
    index % 2 === 1 ? <span key={index} className="preview-hashtag">{part}</span> : part
  );
}

/**
 * The preview card for one post in one platform's feed.
 *
 * Usage:
 *   <PostPreview platform={platform} caption={caption} image={image} altText={altText} device="phone" />
 *   (rendered by PreviewButton below)
 *
 * Takes:
 *   platform - the platform row (key or name picks the previewFeeds entry), or null
 *   caption  - the caption text
 *   image    - ImageField's image: { media (stored row), previewUrl (local file while uploading) }
 *   altText  - shown under the image when set
 *   device   - "phone" (default) or "computer": which caption cut-off to use
 *
 * Returns:
 *   An <aside> hidden from screen readers: the account header, the caption (above or under
 *   the image, per the feed), the image cropped like the feed, the alt text, and for
 *   Instagram a "Profile grid" view with the post as the first of three tiles.
 *
 * How it works:
 *   The image is the stored JPEG once uploaded (what actually gets posted), or the local
 *   file while it uploads. Its size comes from the stored JPEG's record, or is measured once
 *   the picture loads. Instagram also puts the account name in bold before the caption, as
 *   Instagram does.
 *
 * When editing:
 *   Crop shapes, cut-offs and account names are previewFeeds in settings.js. The CSS is
 *   preview.css (the grid uses --tile-ratio).
 */
export default function PostPreview({ platform, caption, image, altText, device = "phone" }) {
  const feed = previewFeeds[platform?.key ?? platform?.name?.toLowerCase()] ?? previewOtherFeed;
  const { shown, cut } = cutCaption(caption ?? "", feed, device);
  const imageUrl = image?.media ? thumbnailUrl(image.media) : image?.previewUrl;
  const [measured, setMeasured] = useState(null);
  const size = image?.media?.width && image?.media?.height
    ? image.media
    : measured?.url === imageUrl ? measured : null;
  const onImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (measured?.url !== imageUrl) setMeasured({ url: imageUrl, width: naturalWidth, height: naturalHeight });
  };
  const frame = frameRatio(size, feed);

  const header = (
    <div className="preview-account">
      <img className="preview-avatar" src={logo} alt="" />
      <div>
        <strong>{feed.account}</strong>
        <span>{platform ? platform.name : "No platform chosen"}</span>
      </div>
    </div>
  );

  const text = (
    <p className={`preview-caption${shown ? "" : " preview-empty"}`}>
      {feed === previewFeeds.instagram && shown && <strong>{feed.account} </strong>}
      {shown ? withHashtags(shown) : "Your caption shows here."}
      {cut && <span className="preview-more">... more</span>}
    </p>
  );

  const picture = (
    <div
      className={`preview-image${frame ? " preview-image-cropped" : ""}`}
      style={frame ? { aspectRatio: frame } : undefined}
    >
      {imageUrl
        ? <img src={imageUrl} alt="" onLoad={onImageLoad} />
        : <span className="preview-no-image">Image</span>}
    </div>
  );

  // Instagram's profile grid: the post as the first of 3 tiles, cropped to the tile shape
  const grid = feed.gridTile && (
    <div className="preview-grid-view">
      <p className="preview-view-label">Profile grid</p>
      <div className="preview-grid" style={{ "--tile-ratio": feed.gridTile }}>
        <div className="preview-grid-tile">
          {imageUrl ? <img src={imageUrl} alt="" /> : <span className="preview-no-image">Image</span>}
        </div>
        <div className="preview-grid-tile preview-grid-placeholder" />
        <div className="preview-grid-tile preview-grid-placeholder" />
      </div>
    </div>
  );

  return (
    <aside className="post-preview" aria-hidden="true">
      <p className="preview-label">
        {platform ? `${platform.name} preview` : "Preview"} <span>Preview: approximate</span>
      </p>
      {grid && <p className="preview-view-label">Feed</p>}
      <div className="preview-card">
        {header}
        {feed.captionFirst && text}
        {picture}
        {altText?.trim() && <p className="preview-alt">Alt text: {altText.trim()}</p>}
        {!feed.captionFirst && text}
      </div>
      {grid}
      {!platform && <p className="preview-hint">Choose a platform to see how its feed shows the post.</p>}
    </aside>
  );
}

/**
 * A "Preview post" button that opens the preview in a dialog, with a Phone / Computer switch
 * (Facebook and LinkedIn cut the caption much earlier on a phone).
 *
 * Usage:
 *   <PreviewButton platform={platform} caption={caption} image={image} altText={altText} />   (Composer, Library)
 *
 * Takes:
 *   platform, caption, image, altText - as for PostPreview
 *
 * Returns:
 *   The button and its <dialog>, or nothing until a platform is chosen (the preview depends
 *   on the platform's feed).
 *
 * How it works:
 *   Opens a native modal dialog; Esc, Close, or a click outside closes it. The preview is
 *   only rendered while the dialog is open. It starts on "phone".
 */
export function PreviewButton({ platform, caption, image, altText }) {
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState("phone");
  if (!platform) return null;
  const show = () => {
    setOpen(true);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className="secondary-button preview-button" onClick={show}>
        Preview post
      </button>
      <dialog
        ref={dialog}
        className="preview-dialog"
        aria-label={`${platform.name} post preview`}
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the dialog itself, not on its content
        onClick={(event) => event.target === dialog.current && close()}
      >
        <div className="preview-dialog-body">
          <div className="mode-toggle preview-device" role="group" aria-label="Show it as on a">
            {[["phone", "Phone"], ["computer", "Computer"]].map(([key, label]) => (
              <button key={key} type="button" className={device === key ? "active-view" : ""}
                aria-pressed={device === key} onClick={() => setDevice(key)}>
                {label}
              </button>
            ))}
          </div>
          {open && <PostPreview platform={platform} caption={caption} image={image} altText={altText} device={device} />}
          <button type="button" className="secondary-button preview-close" onClick={close}>Close</button>
        </div>
      </dialog>
    </>
  );
}
