/**
 * Archive page: old published posts. Archiving hides a post from the Library and frees its
 * full-size image, archived posts can be searched, unarchived, or deleted for good.
 * Only people with "Archive old posts" see this page; deleting for good also needs "Delete posts".
 *
 * What lives here:
 *   VIEWS        the two tabs, Published and Archived
 *   plural       "1 post" / "3 posts"
 *   confirmText  the words to type before deleting for good
 *   sizeLabel    bytes -> "820 KB", "1.4 MB", "2.05 GB"
 *   snippet      a caption shortened for a table row
 *   imageNote    what is left of a post's image, in plain words
 *   Archive      the page (route /archive, needs archivePosts)
 *
 * Page size, caption length and the "Older than" choices (months; 0 = any age; the default
 * is 12, as on the server) are archive* in settings.js.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useCurrentUser } from '../currentUser.js';
import { formatStamp } from '../time.js';
// Tabs, notices and the confirm reuse the Media page's styles
import '../media.css';
import '../archive.css';
import { archiveCaptionChars, archiveDefaultOlderThan, archiveOlderThan, archivePageSize } from '../settings.js';

const VIEWS = [
  { key: 'published', label: 'Published' },
  { key: 'archived', label: 'Archived' },
];

/**
 * A count with the right form of the word.
 *
 * Usage:
 *   plural(3, 'post')                   // "3 posts"
 *   plural(1, 'image is', 'images are') // "1 image is"
 *
 * Takes:
 *   n    - the count
 *   word - the singular form
 *   many - the plural form; default word + "s"
 *
 * Returns:
 *   "<n> <word or many>".
 */
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/**
 * The words to type before deleting for good, e.g. "delete 12 posts" (or "delete 1 post").
 *
 * Usage:
 *   confirmText(deleting.ids.length)
 *
 * When editing:
 *   The server checks the same text (server/src/routes/archive.js); change both together
 *   or every permanent delete is refused.
 */
const confirmText = (count) => `delete ${plural(count, 'post')}`;

/**
 * Image storage in readable units.
 *
 * Usage:
 *   sizeLabel(result.storageBytes)  // "1.4 MB"
 *
 * Takes:
 *   bytes - a number of bytes (0, null or undefined allowed)
 *
 * Returns:
 *   "0 MB" for nothing; KB (whole, at least 1) under 1 MB; MB with one decimal under
 *   1 GB; GB with two decimals above.
 */
function sizeLabel(bytes) {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * A caption shortened for one table row: all whitespace (line breaks too) becomes single
 * spaces, and anything past the length is cut with "...".
 *
 * Usage:
 *   snippet(post.caption)
 *
 * Takes:
 *   text   - the caption (null/undefined allowed)
 *   length - characters kept; default archiveCaptionChars (settings.js)
 *
 * Returns:
 *   A string ("" for no caption).
 */
function snippet(text, length = archiveCaptionChars) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length)}...` : clean;
}

/**
 * What is left of a post's image, in plain words, for the "Image size" column.
 *
 * Usage:
 *   imageNote(post)
 *
 * Takes:
 *   post - an archive row: mediaId, mediaArchivedAt, mediaDeletedAt, mediaSizeBytes
 *
 * Returns:
 *   "No image"; "Small copy kept" (the full image was purged, the 400px copy remains);
 *   "In Recently deleted" (still restorable on the Media page); or the full image's size.
 *   Checked in that order.
 */
function imageNote(post) {
  if (!post.mediaId) return 'No image';
  if (post.mediaArchivedAt) return 'Small copy kept';
  if (post.mediaDeletedAt) return 'In Recently deleted';
  return sizeLabel(post.mediaSizeBytes);
}

/**
 * The Archive page: Published / Archived tabs, filters (platform, "Published more than",
 * caption search), a summary of count and image storage, bulk and per-row actions, and a
 * typed confirm for deleting for good.
 *
 * Usage:
 *   Rendered by App.jsx for the /archive route (needs archivePosts): <Archive />
 *
 * Returns:
 *   The page section.
 *
 * How it works:
 *   1. Loads the time zone and platforms once. The list (GET /api/archive) reloads when
 *      the tab, platform, age or search changes, or after any action (refreshKey); a
 *      reload clears the selection. A reply that arrives after the filters changed again
 *      is ignored.
 *   2. The search only runs on submit (Search button or Enter), not while typing.
 *   3. "Show more" asks for the next page from the number of posts already shown and
 *      appends it.
 *   4. Archive / Unarchive go through run(), which shows the server's summary as a notice
 *      (images moved to Recently deleted, images kept because other posts use them,
 *      images still in Recently deleted after unarchiving) and reloads.
 *   5. Delete permanently shows only on the Archived tab and only with deletePosts; it
 *      opens an inline box and is enabled once confirmText is typed (case and outer
 *      spaces ignored). The typed text is sent to the server, which checks it again.
 *
 * When editing:
 *   The row and summary shapes come from server/src/services/archive.js and
 *   routes/archive.js. The days in Recently deleted come from the server (trashDays);
 *   7 is only a fallback for the message. Archiving never deletes; only the typed confirm
 *   path does.
 */
export default function Archive() {
  const { permissions } = useCurrentUser();
  const [view, setView] = useState('published');
  const [platforms, setPlatforms] = useState([]);
  const [platformId, setPlatformId] = useState('');
  const [olderThan, setOlderThan] = useState(archiveDefaultOlderThan);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [timezone, setTimezone] = useState();
  const [result, setResult] = useState(null); // { posts, total, storageBytes, counts, trashDays }
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  // Deleting for good: the posts it is about and what has been typed so far
  const [deleting, setDeleting] = useState(null); // { ids, typed }
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
    api.platforms().then(setPlatforms).catch(() => {});
  }, []);

  const filters = { view, platformId, olderThan, search, limit: archivePageSize };

  useEffect(() => {
    let cancelled = false;
    setMessage('');
    api.archive(filters).then((data) => {
      if (cancelled) return;
      setResult(data);
      setSelected(new Set());
    }).catch((error) => !cancelled && setMessage(error.message));
    return () => { cancelled = true; };
  }, [view, platformId, olderThan, search, refreshKey]);

  async function loadMore() {
    try {
      const data = await api.archive({ ...filters, offset: result.posts.length });
      setResult({ ...data, posts: [...result.posts, ...data.posts] });
    } catch (error) {
      setMessage(error.message);
    }
  }

  function switchView(key) {
    setView(key);
    setDeleting(null);
    setNotice('');
  }

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  const posts = result?.posts ?? [];
  const allSelected = posts.length > 0 && posts.every((post) => selected.has(post.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(posts.map((post) => post.id)));

  /**
   * Runs one archive action: clears messages, shows the action's returned text as a
   * notice, closes the delete box and reloads the list. Errors show the server's message.
   *
   * Usage:
   *   run(async () => { await api.archivePosts(ids); return 'Archived.'; })
   *
   * Takes:
   *   action - async function returning the notice text
   */
  async function run(action) {
    setBusy(true);
    setMessage('');
    setNotice('');
    try {
      setNotice(await action());
      setDeleting(null);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const archive = (ids) => run(async () => {
    const done = await api.archivePosts(ids);
    const parts = [`Archived ${plural(done.archived.length, 'post')}.`];
    if (done.imagesTrashed.length) {
      parts.push(`${plural(done.imagesTrashed.length, 'image')} moved to Recently deleted on the Media page`
        + ` (restorable for ${plural(result?.trashDays ?? 7, 'day')}; a small copy is kept for these posts after that).`);
    }
    if (done.imagesKept.length) parts.push(`${plural(done.imagesKept.length, 'image')} kept because other posts still use them.`);
    return parts.join(' ');
  });

  const unarchive = (ids) => run(async () => {
    const done = await api.unarchivePosts(ids);
    const parts = [`Unarchived ${plural(done.unarchived.length, 'post')}; they show in the Library again.`];
    if (done.imagesInTrash.length) {
      parts.push(`${plural(done.imagesInTrash.length, 'image is', 'images are')} still in Recently deleted; restore them on the Media page for the full-size picture.`);
    }
    return parts.join(' ');
  });

  const deleteForGood = () => run(async () => {
    const done = await api.deleteArchived(deleting.ids, deleting.typed);
    return `Deleted ${plural(done.deleted.length, 'archived post')} permanently.`;
  });

  const selectedIds = posts.filter((post) => selected.has(post.id)).map((post) => post.id);
  const canDelete = view === 'archived' && permissions.deletePosts;
  const platformName = (id) => platforms.find((platform) => platform.id === id)?.name ?? '';

  return (
    <section className="archive-page">
      <h1>Archive</h1>
      <p>
        Old published posts. Archiving hides a post from the Library and frees its full-size image
        (it goes to Recently deleted when no other post uses it; a small copy is kept with the post).
        Archived posts stay here, can be searched and unarchived, and can be deleted for good.
        Nothing is archived or deleted automatically.
      </p>

      <div className="media-views" role="tablist" aria-label="Which posts">
        {VIEWS.map(({ key, label }) => (
          <button key={key} type="button" role="tab" aria-selected={view === key}
            className={`media-view${view === key ? ' media-view-active' : ''}`} onClick={() => switchView(key)}>
            {label}{result?.counts ? ` (${result.counts[key]})` : ''}
          </button>
        ))}
      </div>

      <form className="archive-filters" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }}>
        <div>
          <label htmlFor="archive-platform">Platform</label>
          <select id="archive-platform" value={platformId} onChange={(event) => setPlatformId(event.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="archive-age">Published more than</label>
          <select id="archive-age" value={olderThan} onChange={(event) => setOlderThan(Number(event.target.value))}>
            {archiveOlderThan.map(({ months, label }) => (
              <option key={months} value={months}>{months ? `${label} ago` : label}</option>
            ))}
          </select>
        </div>
        <div className="archive-search">
          <label htmlFor="archive-search">Caption contains</label>
          <input id="archive-search" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </div>
        <button type="submit" className="secondary-button">Search</button>
      </form>

      {result && (
        <p className="archive-summary" role="status">
          {plural(result.total, view === 'archived' ? 'archived post' : 'published post')}
          {' '}using {sizeLabel(result.storageBytes)} of images.
        </p>
      )}
      {notice && <p className="media-notice" role="status">{notice}</p>}
      {message && <p className="error-text" role="alert">{message}</p>}

      {posts.length > 0 && (
        <div className="archive-bulk" role="group" aria-label="Selected posts">
          <span>{plural(selectedIds.length, 'post')} selected</span>
          {view === 'published' && (
            <button type="button" onClick={() => archive(selectedIds)} disabled={busy || !selectedIds.length}>Archive selected</button>
          )}
          {view === 'archived' && (
            <button type="button" className="secondary-button" onClick={() => unarchive(selectedIds)} disabled={busy || !selectedIds.length}>
              Unarchive selected
            </button>
          )}
          {canDelete && (
            <button type="button" className="remove-button" onClick={() => setDeleting({ ids: selectedIds, typed: '' })}
              disabled={busy || !selectedIds.length}>
              Delete selected permanently
            </button>
          )}
        </div>
      )}

      {deleting && (
        <div className="media-confirm archive-confirm" role="alert">
          <p>
            <strong>Delete {plural(deleting.ids.length, 'archived post')} for good?</strong> The posts, their send history and
            their small image copies (when nothing else uses them) are removed. This cannot be undone.
          </p>
          <label htmlFor="archive-confirm">Type <strong>{confirmText(deleting.ids.length)}</strong> to confirm</label>
          <input id="archive-confirm" value={deleting.typed} autoComplete="off"
            onChange={(event) => setDeleting({ ...deleting, typed: event.target.value })} />
          <div className="media-actions">
            <button type="button" className="remove-button" onClick={deleteForGood}
              disabled={busy || deleting.typed.trim().toLowerCase() !== confirmText(deleting.ids.length)}>
              Delete permanently
            </button>
            <button type="button" className="secondary-button" onClick={() => setDeleting(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {result && posts.length === 0 && !message && (
        <p>{view === 'archived' ? 'No archived posts match.' : 'No published posts match.'}</p>
      )}

      {posts.length > 0 && (
        <div className="table-wrap">
          <table className="inventory-table archive-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" /></th>
                <th>Image</th>
                <th>Post</th>
                <th>Published</th>
                <th>Image size</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(post.id)} onChange={() => toggle(post.id)}
                      aria-label={`Select post ${post.id}`} />
                  </td>
                  <td>
                    {post.mediaId
                      ? <img className="archive-thumb" src={`${post.mediaLink}?inline=1`} alt={post.mediaName ?? ''} loading="lazy" />
                      : <span className="archive-no-image">None</span>}
                  </td>
                  <td>
                    <span className="archive-platform">{post.platformName ?? platformName(post.platformId)}</span>
                    {post.postTypeName && <span className="archive-type"> · {post.postTypeName}</span>}
                    <span className="archive-caption">{snippet(post.caption) || '(no caption)'}</span>
                    <span className="archive-id">Post {post.id}{post.archivedAt ? `, archived ${formatStamp(post.archivedAt, timezone)}` : ''}</span>
                  </td>
                  <td>{formatStamp(post.postedAt, timezone)}</td>
                  <td>{imageNote(post)}</td>
                  <td className="archive-row-actions">
                    {view === 'published' && (
                      <button type="button" className="secondary-button" onClick={() => archive([post.id])} disabled={busy}>Archive</button>
                    )}
                    {view === 'archived' && (
                      <button type="button" className="secondary-button" onClick={() => unarchive([post.id])} disabled={busy}>Unarchive</button>
                    )}
                    {canDelete && (
                      <button type="button" className="remove-button" onClick={() => setDeleting({ ids: [post.id], typed: '' })} disabled={busy}>
                        Delete permanently
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && posts.length < result.total && (
        <div className="post-actions"><button type="button" className="secondary-button" onClick={loadMore}>Show more</button></div>
      )}
    </section>
  );
}
