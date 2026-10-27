import { useEffect, useState } from "react";
import "../media.css";

const PAGE_SIZE = 48;

// Thumbnails from GET /api/media. Drive images need ?inline=1 so the server
// streams the bytes instead of redirecting to Drive's viewer page.
export const thumbnailUrl = (media) => `${media.link}?inline=1`;

export function usedInLabel(media) {
  const count = media.usedBy?.length ?? 0;
  if (count === 0) return "Not used yet";
  return `Used in ${count} post${count === 1 ? "" : "s"}`;
}

async function fetchMedia({ search, offset }) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search) params.set("search", search);
  const res = await fetch(`/api/media?${params}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return { items: await res.json(), total: Number(res.headers.get("X-Total-Count") ?? 0) };
}

/**
 * Searchable grid of uploaded images.
 * Props: onSelect(media) when a thumbnail is clicked, selectedId to highlight one,
 * refreshKey to reload after an upload elsewhere.
 */
export default function MediaPicker({ onSelect, selectedId = null, refreshKey = 0 }) {
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Wait for a pause in typing before searching
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchMedia({ search, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [search, refreshKey]);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await fetchMedia({ search, offset: items.length });
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
        <p className="media-empty">{search ? `No images match "${search}".` : "No images uploaded yet."}</p>
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
              <span className="media-tile-meta">{usedInLabel(media)}</span>
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
