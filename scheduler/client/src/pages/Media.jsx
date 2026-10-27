import { useEffect, useState } from "react";
import MediaPicker, { thumbnailUrl, usedInLabel } from "../components/MediaPicker.jsx";
import "../media.css";

async function getJson(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
function formatUploaded(createdAt) {
  if (!createdAt) return "";
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString();
}

const typeLabel = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

export default function Media() {
  const [selected, setSelected] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [checks, setChecks] = useState({}); // platformId -> { ok, warnings } | { error }

  useEffect(() => {
    getJson("/platforms")
      .then((all) => setPlatforms(all.filter((platform) => platform.enabled)))
      .catch(() => {});
  }, []);

  // Format check for the selected image on every enabled platform
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

  const platformName = (id) => platforms.find((p) => p.id === id)?.name ?? `Platform ${id}`;

  return (
    <section>
      <h1>Media</h1>

      <div className="media-page">
        <MediaPicker onSelect={setSelected} selectedId={selected?.id ?? null} />

        <aside className="media-details" aria-live="polite">
          {!selected ? (
            <p className="media-empty">Choose an image to see its details and where it is used.</p>
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
              </dl>
              <p>
                <a href={selected.link} target="_blank" rel="noreferrer">Open the original</a>
              </p>

              {platforms.length > 0 && (
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
