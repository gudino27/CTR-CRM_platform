// Deliverable 1: platform, caption, hashtags, image -> platform queue.
// TODO(Sprint 4): form, character count per platform limit, image select/upload, submit to POST /api/posts.
import { useState } from "react";

export default function Composer() {
  const [platform, setPlatform] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [image, setImage] = useState(null);
  const [priority, setPriority] = useState("normal");
  const [overrideDate, setOverrideDate] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    const post = {
      platform,
      caption,
      hashtags,
      image,
      priority,
      overrideDate: overrideDate || null,
    };

    console.log("Post submitted:", post);
  }

  return (
    <section>
      <h1>Compose</h1>

      <form onSubmit={handleSubmit}>
        {/* Platform */}
        <div>
          <label htmlFor="platform">Platform</label>

          <select
            id="platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            required
          >
            <option value="">Select a platform</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </div>

        {/* Caption */}
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

          <p>Characters: {caption.length}</p>
        </div>

        {/* Hashtags */}
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

        {/* Image */}
        <div>
          <label htmlFor="image">Image</label>

          <input
            id="image"
            type="file"
            accept="image/*"
            onChange={(event) =>
              setImage(event.target.files?.[0] || null)
            }
          />

          {image && <p>Selected image: {image.name}</p>}
        </div>

        {/* Priority */}
        <div>
          <label htmlFor="priority">Priority</label>

          <select
            id="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>

        {/* Optional Override Date */}
        <div>
          <label htmlFor="overrideDate">
            Override Date (Optional)
          </label>

          <input
            id="overrideDate"
            type="date"
            value={overrideDate}
            onChange={(event) => setOverrideDate(event.target.value)}
          />
        </div>

        {/* Submit */}
        <button type="submit">
          Add to Queue
        </button>
      </form>
    </section>
  );
}