// Uploads images to the team's Workspace Drive folder (Deliverable 1).
// n8n fetches them by driveFileId, so the app only stores the pointer.
import { Readable } from 'node:stream';
import { drive } from '@googleapis/drive';
import { config } from '../config.js';
import { googleOAuthClient } from './googleAuth.js';

function createDriveUploader(google = config.google) {
  const auth = googleOAuthClient(google);
  if (!auth || !google.driveFolderId) return null;
  const files = drive({ version: 'v3', auth }).files;

  return async (buffer, { name, mimeType }) => {
    const res = await files.create({
      requestBody: { name, parents: [google.driveFolderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });
    return { id: res.data.id, webViewLink: res.data.webViewLink };
  };
}

let uploader = createDriveUploader();

/** fn(buffer, { name, mimeType }) => { id, webViewLink }, or null when Drive isn't configured. */
export const driveUploader = () => uploader;

/** Tests swap in a fake uploader (or null for the local-disk fallback). */
export function setDriveUploader(fn) {
  uploader = fn;
}
