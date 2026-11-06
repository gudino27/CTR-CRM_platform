/**
 * The media library grid (search, pages of thumbnails, "Show more") and the small helpers
 * for showing a media row: thumbnailUrl, daysLeftLabel, usedInLabel. Used by the Media page
 * and by ImageField's "Choose from media library".
 */
import { useEffect, useState } from "react";
import { mediaPageSize, mediaSearchDelayMs } from "../settings.js";
import "../media.css";

/**
 * The address to show a stored image in the page (thumbnails, previews).
 *
 * Usage:
 *   <img src={thumbnailUrl(media)} alt="" />
 *
 * Takes:
 *   media - a media row, or just { id }; sha256 is used when present
 *
 * Returns:
 *   "/api/media/<id>/file?inline=1&v=<first 12 of sha256>".
 *
 * How it works:
 *   Built from the id, because a full media row's link can be Drive's viewer page. Drive
 *   images need ?inline=1 so the server streams the bytes instead of redirecting to Drive's
 *   viewer page. v= changes when the image is rotated, so the browser doesn't show the old
 *   picture from its cache.
 */
export const thumbnailUrl = (media) =>
  `/api/media/${media.id}/file?inline=1${media.sha256 ? `&v=${media.sha256.slice(0, 12)}` : ""}`;

/**
 * The restore countdown for an image in Recently deleted.
 *
 * Usage:
 *   daysLeftLabel(media)   // "3 days left to restore"
 *
 * Returns:
 *   "N day(s) left to restore", "Deleted for good soon" at 0, or "" when the row has no daysLeft.
 */
export function daysLeftLabel(media) {
  if (media.daysLeft == null) return "";
  if (media.daysLeft === 0) return "Deleted for good soon";
  return `${media.daysLeft} day${media.daysLeft === 1 ? "" : "s"} left to restore`;
}

/**
 * How many posts use an image.
 *
 * Usage:
 *   usedInLabel(media)   // "Used in 2 posts"
 *
 * Returns:
 *   "Not used yet" or "Used in N post(s)", from media.usedBy.
 */
export function usedInLabel(media) {
  const count = media.usedBy?.length ?? 0;
  if (count === 0) return "Not used yet";
  return `Used in ${count} post${count === 1 ? "" : "s"}`;
}

/**
 * One page of GET /api/media.
 *
 * Takes:
 *   search - text to match file names, or empty
 *   offset - how many are already shown
 *   view   - "library" (sent as no view), "deleted" or "archived"
 *
 * Returns:
 *   { items (media rows), total (X-Total-Count), trashDays (X-Trash-Days, the restore window, or null) }.
 *   Throws an Error with the server's message.
 *
 * When editing:
 *   Calls fetch directly (not api.js) to read the two headers; the session watch still sees it.
 *   Page size is mediaPageSize in settings.js.
 */
async function fetchMedia({ search, offset, view }) {
  const params = new URLSearchParams({ limit: String(mediaPageSize), offset: String(offset) });
  if (search) params.set("search", search);
  if (view && view !== "library") params.set("view", view);
  const res = await fetch(`/api/media?${params}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return {
    items: await res.json(),
    total: Number(res.headers.get("X-Total-Count") ?? 0),
    trashDays: Number(res.headers.get("X-Trash-Days") ?? 0) || null,
  };
}

const emptyText = {
  library: "No images uploaded yet.",
  deleted: "Nothing was deleted recently.",
  archived: "No low-resolution copies are kept.",
};

/**
 * Searchable grid of uploaded images.
 *
 * Usage:
 *   <MediaPicker onSelect={chooseFromLibrary} selectedId={image?.media?.id ?? null} />   (ImageField.jsx)
 *
 * Takes:
 *   onSelect    - called with the media row when a thumbnail is clicked
 *   selectedId  - id of the image to highlight; default null
 *   refreshKey  - change it to reload, e.g. after an upload elsewhere; default 0
 *   view        - "library" (default), "deleted" for Recently deleted, "archived" for
 *                 low-resolution copies kept for history
 *   onTrashDays - called with the restore window (days) the server uses
 *
 * Returns:
 *   The search box, the grid (each tile shows the name and "Used in ..." or the restore
 *   countdown), "Show more (N left)" while more pages remain, and empty/loading/error text.
 *
 * How it works:
 *   Waits mediaSearchDelayMs (settings.js) after the last key before searching, then loads
 *   the first page again; "Show more" appends the next page.
 *
 * When editing:
 *   Choosing an image needs no permission, so the picker has no actions to hide; the pages
 *   around it hide upload, rotate, delete and restore.
 */
export default function MediaPicker({ onSelect, selectedId = null, refreshKey = 0, view = "library", onTrashDays }) {
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), mediaSearchDelayMs);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchMedia({ search, offset: 0, view })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        if (page.trashDays) onTrashDays?.(page.trashDays);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [search, refreshKey, view]); // not onTrashDays: a new function each render would reload the grid

  async function loadMore() {
    setLoading(true);
    try {
      const page = await fetchMedia({ search, offset: items.length, view });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="media-picker">
      <label htmlFor="mediaSearch" className="media-visually-hidden">Search images</label>
      <input
        id="mediaSearch"
        className="media-search"
        type="search"
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        placeholder="Search images by file name"
      />

      {error && <p className="error-text">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="media-empty">{search ? `No images match "${search}".` : emptyText[view] ?? emptyText.library}</p>
      )}

      <ul className="media-grid">
        {items.map((media) => (
          <li key={media.id}>
            <button
              type="button"
              className={`media-tile${media.id === selectedId ? " media-tile-selected" : ""}`}
              aria-pressed={media.id === selectedId}
              onClick={() => onSelect?.(media)}
              title={media.name}
            >
              <img src={thumbnailUrl(media)} alt="" loading="lazy" />
              <span className="media-tile-name">{media.name}</span>
              <span className="media-tile-meta">
                {view === "deleted" ? daysLeftLabel(media) : view === "archived" ? "Low-resolution copy" : usedInLabel(media)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {items.length < total && (
        <button type="button" className="media-more" onClick={loadMore} disabled={loading}>
          {loading ? "Loading..." : `Show more (${total - items.length} left)`}
        </button>
      )}
      {loading && items.length === 0 && <p className="media-empty">Loading images...</p>}
    </div>
  );
}
