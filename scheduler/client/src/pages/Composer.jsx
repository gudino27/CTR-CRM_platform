import { useState } from "react";

export default function Composer() {
  const [platform, setPlatform] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [image, setImage] = useState(null);
  const [priority, setPriority] = useState("normal");
  const [overrideDate, setOverrideDate] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    const newPost = {
      id: Date.now(),
      platform,
      caption,
      hashtags,
      imageName: image ? image.name : "",
      priority,
      overrideDate: overrideDate || "",
      status: "queued",
    };

    const savedPosts =
      JSON.parse(localStorage.getItem("ctrPosts")) || [];

    const updatedPosts = [...savedPosts, newPost];

    localStorage.setItem(
      "ctrPosts",
      JSON.stringify(updatedPosts)
    );

    setMessage("Post added to queue.");

    setPlatform("");
    setCaption("");
    setHashtags("");
    setImage(null);
    setPriority("normal");
    setOverrideDate("");

    event.target.reset();
  }

  return (
    <section>
      <h1>Compose</h1>

      <form onSubmit={handleSubmit}>
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

          <input
            id="image"
            type="file"
            accept="image/*"
            onChange={(event) =>
              setImage(event.target.files?.[0] || null)
            }
          />

          {image && (
            <p>Selected image: {image.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="priority">Priority</label>

          <select
            id="priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value)
            }
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
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
          />
        </div>

        <button type="submit">
          Add to Queue
        </button>

        {message && <p>{message}</p>}
      </form>
    </section>
  );
}