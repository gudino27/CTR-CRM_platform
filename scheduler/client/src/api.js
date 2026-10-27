async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? res.statusText);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  status: () => request('/status'),
  platforms: () => request('/platforms'),
  updatePlatform: (id, changes) => request(`/platforms/${id}`, { method: 'PATCH', body: changes }),
  addPostType: (platformId, type) => request(`/platforms/${platformId}/post-types`, { method: 'POST', body: type }),
  updatePostType: (platformId, typeId, changes) =>
    request(`/platforms/${platformId}/post-types/${typeId}`, { method: 'PATCH', body: changes }),
  // posts("queued,failed") or posts({ status, platformId, kind, placed })
  posts: (filters = {}) => {
    const { status = 'queued', platformId, kind, placed } = typeof filters === 'string' ? { status: filters } : filters;
    return request(`/posts${query({ status, platformId, kind, placed })}`);
  },
  createPost: (post) => request('/posts', { method: 'POST', body: post }),
  updatePost: (id, changes) => request(`/posts/${id}`, { method: 'PATCH', body: changes }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  // Failed fixed posts need { fixedAt }; library posts go back to the pool with no body
  requeuePost: (id, body) => request(`/posts/${id}/requeue`, { method: 'POST', body }),
  slots: (platformId, month) => request(`/slots${query({ platformId, month })}`),
  updateSlot: (id, changes) => request(`/slots/${id}`, { method: 'PATCH', body: changes }),
  inventory: (months) => request(`/inventory${query({ months })}`),
  brief: (days = 14) => request(`/brief${query({ days })}`),
  // The raw file is the body; the server sniffs the type itself
  uploadMedia: async (file) => {
    const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
};
