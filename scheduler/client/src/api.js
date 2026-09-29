async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.status === 204 ? null : res.json();
}

export const api = {
  status: () => request('/status'),
  platforms: () => request('/platforms'),
  updatePlatform: (id, changes) => request(`/platforms/${id}`, { method: 'PATCH', body: changes }),
  posts: (status = 'queued') => request(`/posts?status=${status}`),
  createPost: (post) => request('/posts', { method: 'POST', body: post }),
  updatePost: (id, changes) => request(`/posts/${id}`, { method: 'PATCH', body: changes }),
  movePost: (id, direction) => request(`/posts/${id}/move`, { method: 'POST', body: { direction } }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  requeuePost: (id) => request(`/posts/${id}/requeue`, { method: 'POST' }),
  // The raw file is the body; the server sniffs the type itself
  uploadMedia: async (file) => {
    const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
};
