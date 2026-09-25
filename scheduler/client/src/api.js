async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  status: () => request('/status'),
  platforms: () => request('/platforms'),
  posts: (platformId) => request(`/posts${platformId ? `?platformId=${platformId}` : ''}`),
};
