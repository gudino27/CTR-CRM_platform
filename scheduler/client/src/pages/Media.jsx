/**
 * Media page: every uploaded image, with its details, platform format checks, where it is
 * used, rotate, delete (to Recently deleted), restore, and the small copies kept for history.
 *
 * What lives here:
 *   getJson         GET /api/<path> as JSON, throwing the server's error message
 *   formatUploaded  an upload/delete stamp in the app zone
 *   typeLabel       MIME type -> short name (JPEG, PNG, WebP)
 *   ROTATIONS       the rotate buttons, in clockwise degrees as the server takes them
 *   statusLabel     post status -> words, for the "still used by" list
 *   VIEWS           the three tabs
 *   Media           the page (route /media)
 *
 * Images per page and the search delay are mediaPageSize and mediaSearchDelayMs in
 * settings.js (used by components/MediaPicker.jsx).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api.js";
import { useCurrentUser } from "../currentUser.js";
import MediaPicker, { daysLeftLabel, thumbnailUrl, usedInLabel } from "../components/MediaPicker.jsx";
import "../media.css";
import { formatStamp } from "../time.js";

/**
 * Fetches an API path as JSON.
 *
 * Usage:
 *   await getJson(`/media/${id}/check?platformId=2`)
 *
 * Takes:
 *   path - the part after /api, starting with "/"
 *
 * Returns:
 *   The parsed JSON. Throws an Error with the server's { error } text (or the status
 *   text) when the response is not OK.
 */
async function getJson(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
/**
 * Shows a media row's createdAt or deletedAt in the app time zone (New York), with the
 * viewer's own time when they are elsewhere (formatStamp in time.js).
 *
 * Usage:
 *   formatUploaded(selected.createdAt)
 */
const formatUploaded = (createdAt) => formatStamp(createdAt);

const typeLabel = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };
// Clockwise degrees, as the server takes them
const ROTATIONS = [
  { degrees: 270, label: "Rotate left" },
  { degrees: 90, label: "Rotate right" },
  { degrees: 180, label: "Turn upside down" },
];
const statusLabel = { queued: "scheduled", sending: "sending now", failed: "failed, waiting to be retried" };

// The library, Recently deleted (restore within the window; needs deleteMedia) and the
// small copies kept for history
const VIEWS = [
  { key: "library", label: "Library" },
  { key: "deleted", label: "Recently deleted", needs: "deleteMedia" },
  { key: "archived", label: "Kept for history" },
];

/**
 * The Media page: tabs (Library, Recently deleted, Kept for history), the image grid
 * (MediaPicker) and a details panel for the chosen image.
 *
 * Usage:
 *   Rendered by App.jsx for the /media route: <Media />
 *
 * Returns:
 *   The page section. The details panel shows type, pixel size, upload time, how it was
 *   converted (original type, turned upright from the camera's setting, rotation since
 *   upload), platform checks, the posts that use it, and the actions the viewer may use.
 *
 * How it works:
 *   1. Loads the enabled platforms once. Changing tab clears the selection and notice.
 *   2. Choosing an image runs the format check for it on every enabled platform
 *      (GET /api/media/:id/check), one request each, and loads its conversion details
 *      (GET /api/media/:id). It also resets the delete flow. Replies for an image that is
 *      no longer selected are ignored.
 *   3. Rotate (uploadMedia, Library tab): see rotateSelected() below.
 *   4. Delete (deleteMedia, Library tab): an in-page "Are you sure?" first; the image
 *      moves to Recently deleted. A 409 (still used by posts not yet sent) shows the
 *      server's message and the posts that block it.
 *   5. Restore (deleteMedia, Recently deleted tab) brings it back to the library.
 *   6. The restore window ("for N days") comes from the server via MediaPicker's
 *      onTrashDays; until it arrives the text says "a few".
 *
 * When editing:
 *   Deleting never removes a file right away; the trash and purge rules are in
 *   server/src/services/mediaTrash.js. The checks' rules are imageRules in
 *   server/src/settings.js.
 */
export default function Media() {
  const { permissions } = useCurrentUser();
  const [view, setView] = useState("library");
  const [trashDays, setTrashDays] = useState(null);
  const [selected, setSelected] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [checks, setChecks] = useState({}); // platformId -> { ok, warnings } | { error }
  const [conversion, setConversion] = useState(null); // from GET /api/media/:id
  const [refreshKey, setRefreshKey] = useState(0);
  // Delete flow: confirming shows the in-page "Are you sure?"; deleteError holds a 409's message and posts
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null); // { message, usedBy }
  const [busy, setBusy] = useState(""); // "rotate" | "restore" while that request runs
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getJson("/platforms")
      .then((all) => setPlatforms(all.filter((platform) => platform.enabled)))
      .catch(() => {});
  }, []);

  // Step 2: format checks
  useEffect(() => {
    if (!selected || platforms.length === 0) return;
    let cancelled = false;
    setChecks({});
    for (const platform of platforms) {
      getJson(`/media/${selected.id}/check?platformId=${platform.id}`)
        .then((result) => !cancelled && setChecks((current) => ({ ...current, [platform.id]: result })))
        .catch((error) => !cancelled && setChecks((current) => ({ ...current, [platform.id]: { error: error.message } })));
    }
    return () => { cancelled = true; };
  }, [selected?.id, platforms]);

  // Step 2: conversion details and a fresh delete flow
  useEffect(() => {
    setConfirming(false);
    setDeleteError(null);
    setActionError("");
    setConversion(null);
    if (!selected) return;
    let cancelled = false;
    api.media(selected.id)
      .then((media) => !cancelled && setConversion(media.conversion ?? null))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id]);

  function changeView(next) {
    setView(next);
    setSelected(null);
    setNotice("");
  }

  /**
   * Moves the selected image to Recently deleted, after the inline confirm.
   *
   * Returns:
   *   Nothing. On success clears the selection and reloads the grid. On error (409 when
   *   posts still need it) shows the message and the blocking posts (error.body.usedBy).
   */
  async function deleteSelected() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteMedia(selected.id);
      setNotice(`"${selected.name}" moved to Recently deleted.`);
      setSelected(null);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setDeleteError({ message: error.message, usedBy: error.body?.usedBy ?? [] });
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Rotates the selected image on the server.
   *
   * Usage:
   *   rotateSelected(90)  // one of ROTATIONS' degrees
   *
   * Takes:
   *   degrees - 90, 180 or 270, clockwise
   *
   * How it works:
   *   1. POSTs the rotation; the server returns the new width, height, sha256 and
   *      conversion details.
   *   2. Keeps the list row's fields (link, usedBy) and takes the new size and hash.
   *   3. Posts that already went out moved to a copy of the earlier version
   *      (keptVersion.postIds), so they leave usedBy, and a notice says where that copy
   *      is (Kept for history).
   *   4. Reloads the grid.
   */
  async function rotateSelected(degrees) {
    setBusy("rotate");
    setActionError("");
    try {
      const turned = await api.rotateMedia(selected.id, degrees);
      const moved = new Set(turned.keptVersion?.postIds ?? []);
      setSelected((current) => ({
        ...current, width: turned.width, height: turned.height, sha256: turned.sha256,
        usedBy: (current.usedBy ?? []).filter((post) => !moved.has(post.postId)),
      }));
      setConversion(turned.conversion ?? null);
      if (moved.size > 0) {
        const count = moved.size === 1 ? "1 post that already went out keeps" : `${moved.size} posts that already went out keep`;
        setNotice(`Rotated. ${count} the image as it was; you can find it under Kept for history.`);
      }
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy("");
    }
  }

  /**
   * Brings the selected image back from Recently deleted to the library, then clears the
   * selection and reloads the grid. Errors show under the actions.
   */
  async function restoreSelected() {
    setBusy("restore");
    setActionError("");
    try {
      await api.restoreMedia(selected.id);
      setNotice(`"${selected.name}" is back in the library.`);
      setSelected(null);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy("");
    }
  }

  const platformName = (id) => platforms.find((p) => p.id === id)?.name ?? `Platform ${id}`;

  return (
    <section>
      <h1>Media</h1>

      <div className="media-views" role="tablist" aria-label="Which images">
        {VIEWS.filter((v) => !v.needs || permissions[v.needs]).map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`media-view${view === v.key ? " media-view-active" : ""}`}
            onClick={() => changeView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "deleted" && (
        <p className="media-view-hint">
          Deleted images can be restored for {trashDays ?? "a few"} days. After that they are deleted for good; posts that
          already went out keep a low-resolution copy for history.
        </p>
      )}
      {view === "archived" && (
        <p className="media-view-hint">
          Images kept so the posts that already went out still show the picture they were published with: low-resolution
          copies of images deleted for good, and earlier versions of images that were rotated afterwards. They cannot be
          restored or used in new posts.
        </p>
      )}
      {notice && <p className="media-notice" role="status">{notice}</p>}

      <div className="media-page">
        <MediaPicker
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
          refreshKey={refreshKey}
          view={view}
          onTrashDays={setTrashDays}
        />

        <aside className="media-details" aria-live="polite">
          {!selected ? (
            <p className="media-empty">
              {view === "deleted" ? "Choose an image to see how long it can still be restored." : "Choose an image to see its details and where it is used."}
            </p>
          ) : (
            <>
              <img className="media-details-preview" src={thumbnailUrl(selected)} alt={selected.name} />
              <h2>{selected.name}</h2>
              <dl className="media-facts">
                <dt>Type</dt>
                <dd>{typeLabel[selected.mimeType] ?? selected.mimeType ?? "Unknown"}</dd>
                <dt>Size</dt>
                <dd>{selected.width && selected.height ? `${selected.width} x ${selected.height} px` : "Unknown"}</dd>
                <dt>Uploaded</dt>
                <dd>{formatUploaded(selected.createdAt)}</dd>
                {conversion && conversion.originalMimeType !== "image/jpeg" && (
                  <>
                    <dt>Uploaded as</dt>
                    <dd>
                      {typeLabel[conversion.originalMimeType] ?? conversion.originalMimeType}, converted to JPEG
                    </dd>
                  </>
                )}
                {conversion?.rotatedFromExif && (
                  <>
                    <dt>Orientation</dt>
                    <dd>Turned upright using the camera's orientation setting</dd>
                  </>
                )}
                {conversion?.rotation > 0 && (
                  <>
                    <dt>Rotated</dt>
                    <dd>{conversion.rotation}° to the right since it was uploaded</dd>
                  </>
                )}
                {view === "deleted" && (
                  <>
                    <dt>Deleted</dt>
                    <dd>{formatUploaded(selected.deletedAt)}</dd>
                    <dt>Restore</dt>
                    <dd>{daysLeftLabel(selected)}</dd>
                  </>
                )}
              </dl>

              {view === "archived" && (selected.archiveNote ? (
                <p className="media-notice">
                  {selected.archiveNote}. Kept for the posts that already went out with it; the image itself was rotated
                  for posts going out from then on.
                </p>
              ) : (
                <p className="media-notice">Low-resolution copy kept for history. The full-quality image was deleted for good and cannot be restored.</p>
              ))}

              {view === "library" && (
                <p>
                  <a href={selected.link} target="_blank" rel="noreferrer">Open the image</a>
                </p>
              )}

              {view === "library" && permissions.uploadMedia && (
                <div className="media-actions" role="group" aria-label="Rotate the image">
                  {ROTATIONS.map(({ degrees, label }) => (
                    <button key={degrees} type="button" className="secondary-button" onClick={() => rotateSelected(degrees)} disabled={Boolean(busy)}>
                      {label}
                    </button>
                  ))}
                  {busy === "rotate" && <span role="status">Rotating...</span>}
                  <p className="media-view-hint">
                    Rotating changes this image for posts that haven't gone out yet. Posts that were already published keep
                    the original.
                  </p>
                </div>
              )}

              {view === "deleted" && permissions.deleteMedia && (
                <div className="media-actions">
                  <button type="button" onClick={restoreSelected} disabled={Boolean(busy)}>
                    {busy === "restore" ? "Restoring..." : "Restore"}
                  </button>
                </div>
              )}
              {actionError && <p className="error-text" role="alert">{actionError}</p>}

              {view === "library" && (
              <div className="media-actions">
                <Link className="media-action-link" to={`/compose?mediaId=${selected.id}`}>Use in a new post</Link>
                {!confirming && permissions.deleteMedia && (
                  <button type="button" className="remove-button" onClick={() => setConfirming(true)}>
                    Delete
                  </button>
                )}
              </div>
              )}
              {confirming && (
                <div className="media-confirm" role="alert">
                  <p>
                    Are you sure? The image moves to Recently deleted, where it can be restored
                    for {trashDays ?? "a few"} days. After that it is deleted for good
                    {selected.usedBy.length > 0 ? "; posts that already went out keep a low-resolution copy for history" : ""}.
                  </p>
                  <div className="media-actions">
                    <button type="button" className="remove-button" onClick={deleteSelected} disabled={deleting}>
                      {deleting ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setConfirming(false)} disabled={deleting}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {deleteError && (
                <div className="media-delete-error" role="alert">
                  <p className="error-text">{deleteError.message}</p>
                  {deleteError.usedBy.length > 0 && (
                    <ul className="media-used-by">
                      {deleteError.usedBy.map((post) => (
                        <li key={post.postId}>
                          <span className="media-used-platform">
                            {platformName(post.platformId)}, {statusLabel[post.status] ?? post.status}
                          </span>
                          <span className="media-used-caption">{post.caption || "(no caption)"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {view === "library" && platforms.length > 0 && (
                <>
                  <h3>Platform checks</h3>
                  <ul className="media-checks">
                    {platforms.map((platform) => {
                      const check = checks[platform.id];
                      return (
                        <li key={platform.id}>
                          <strong>{platform.name}:</strong>{" "}
                          {!check && "Checking..."}
                          {check?.error && <span className="error-text">{check.error}</span>}
                          {check?.ok && <span className="media-ok">Looks good</span>}
                          {check && !check.ok && !check.error && (
                            <ul>
                              {check.warnings.map((warning) => (
                                <li key={warning} className="media-warning">{warning}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <h3>{usedInLabel(selected)}</h3>
              {selected.usedBy.length > 0 && (
                <ul className="media-used-by">
                  {selected.usedBy.map((post) => (
                    <li key={post.postId}>
                      <span className="media-used-platform">{platformName(post.platformId)}</span>
                      <span className="media-used-caption">{post.caption || "(no caption)"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
