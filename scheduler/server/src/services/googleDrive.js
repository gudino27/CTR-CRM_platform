/**
 * Uploads images to the team's Workspace Drive folder (Deliverable 1). n8n fetches them by
 * driveFileId, so the app only stores the pointer.
 *
 * What lives here: one maker per Drive call (upload, download, delete, update, trash), each
 * returning a small function or null when Google is not set up; a getter for each, which
 * routes and services call at use time; a setter for each, so a fake can be swapped in
 * (used by the tests); and isNotFound for telling "file is gone" apart from other errors.
 *
 * When editing:
 *   The functions are made once when the server starts, from config.google. Callers always go
 *   through the getters (driveUploader() etc.) so a swapped-in function takes effect; never
 *   keep a copy of the function itself. supportsAllDrives is set on every call because the
 *   folder may sit in a shared drive.
 */
import { Readable } from 'node:stream';
import { drive } from '@googleapis/drive';
import { config } from '../config.js';
import { googleOAuthClient } from './googleAuth.js';

/**
 * Makes the upload function: puts a new file in the Drive folder.
 *
 * Takes:
 *   google - config.google by default; needs the OAuth values and driveFolderId
 *
 * Returns:
 *   async (buffer, { name, mimeType }) => { id, webViewLink }, or null when the credentials
 *   or DRIVE_FOLDER_ID are missing (the upload route then stores the file on local disk).
 */
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

/**
 * Makes the download function: reads a file's bytes back, so thumbnails can be served from
 * the app instead of Drive's viewer page (and rotation and the small copy have a source).
 *
 * Returns:
 *   async (fileId) => Buffer, or null when Google isn't configured. Drive errors are thrown.
 */
function createDriveDownloader(google = config.google) {
  const auth = googleOAuthClient(google);
  if (!auth) return null;
  const files = drive({ version: 'v3', auth }).files;
  return async (fileId) => {
    const res = await files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  };
}

/**
 * Makes the delete function: removes a file for good when its image is deleted from the
 * media library.
 *
 * Returns:
 *   async (fileId) => void, or null when Google isn't configured. A file that is already
 *   gone (404) counts as done; other errors are thrown.
 *
 * When editing:
 *   This skips Drive's trash: the file cannot be brought back afterwards.
 */
function createDriveDeleter(google = config.google) {
  const auth = googleOAuthClient(google);
  if (!auth) return null;
  const files = drive({ version: 'v3', auth }).files;
  return async (fileId) => {
    try {
      await files.delete({ fileId, supportsAllDrives: true });
    } catch (err) {
      if (Number(err.code ?? err.status ?? err.response?.status) !== 404) throw err;
    }
  };
}

/**
 * Makes the update function: puts new bytes in an existing file (after a rotation), so its
 * id and link stay the same.
 *
 * Returns:
 *   async (fileId, buffer, { mimeType }) => { id, webViewLink }, or null when Google isn't
 *   configured. Drive errors are thrown.
 */
function createDriveUpdater(google = config.google) {
  const auth = googleOAuthClient(google);
  if (!auth) return null;
  const files = drive({ version: 'v3', auth }).files;
  return async (fileId, buffer, { mimeType }) => {
    const res = await files.update({
      fileId,
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });
    return { id: res.data.id, webViewLink: res.data.webViewLink };
  };
}

/**
 * Makes the trash function: moves a file to Drive's trash (trashed true) or back out of it
 * (false); the id stays the same. Used by "Recently deleted" (services/mediaTrash.js).
 *
 * Returns:
 *   async (fileId, trashed) => void, or null when Google isn't configured.
 *
 * When editing:
 *   A 404 is thrown as is (unlike the deleter), so restore can tell "Drive no longer has it"
 *   apart from other errors; callers check it with isNotFound.
 */
function createDriveTrasher(google = config.google) {
  const auth = googleOAuthClient(google);
  if (!auth) return null;
  const files = drive({ version: 'v3', auth }).files;
  return async (fileId, trashed) => {
    await files.update({ fileId, requestBody: { trashed }, supportsAllDrives: true });
  };
}

/**
 * True for Google API errors meaning the file does not exist (any more).
 *
 * Usage:
 *   if (!isNotFound(err)) throw err;   // services/mediaTrash.js
 *
 * Takes:
 *   err - an error from a Drive call (may be null); the status is read from err.code,
 *         err.status or err.response.status
 *
 * Returns:
 *   true when that status is 404, otherwise false.
 */
export const isNotFound = (err) => Number(err?.code ?? err?.status ?? err?.response?.status) === 404;

let uploader = createDriveUploader();
let downloader = createDriveDownloader();
let deleter = createDriveDeleter();
let updater = createDriveUpdater();
let trasher = createDriveTrasher();

/**
 * The current upload function. Read it at use time, not once.
 *
 * Usage:
 *   const upload = driveUploader(); if (upload) await upload(buffer, { name, mimeType });
 *
 * Returns:
 *   fn(buffer, { name, mimeType }) => { id, webViewLink }, or null when Drive isn't configured.
 */
export const driveUploader = () => uploader;

/**
 * Replaces the upload function (the tests pass a fake, or null for the local-disk fallback).
 *
 * Takes:
 *   fn - a function with the same shape as driveUploader() returns, or null
 */
export function setDriveUploader(fn) {
  uploader = fn;
}

/**
 * The current download function.
 *
 * Returns:
 *   fn(driveFileId) => Buffer, or null when Google isn't configured.
 */
export const driveDownloader = () => downloader;

/**
 * Replaces the download function (the tests pass a fake).
 *
 * Takes:
 *   fn - a function with the same shape as driveDownloader() returns, or null
 */
export function setDriveDownloader(fn) {
  downloader = fn;
}

/**
 * The current delete function.
 *
 * Returns:
 *   fn(driveFileId) => void (ignores 404), or null when Google isn't configured.
 */
export const driveDeleter = () => deleter;

/**
 * Replaces the delete function (the tests pass a fake).
 *
 * Takes:
 *   fn - a function with the same shape as driveDeleter() returns, or null
 */
export function setDriveDeleter(fn) {
  deleter = fn;
}

/**
 * The current update function.
 *
 * Returns:
 *   fn(driveFileId, buffer, { mimeType }) => { id, webViewLink }, or null when Google isn't configured.
 */
export const driveUpdater = () => updater;

/**
 * Replaces the update function (the tests pass a fake).
 *
 * Takes:
 *   fn - a function with the same shape as driveUpdater() returns, or null
 */
export function setDriveUpdater(fn) {
  updater = fn;
}

/**
 * The current trash function.
 *
 * Returns:
 *   fn(driveFileId, trashed) => void (throws on 404, see isNotFound), or null when Google isn't configured.
 */
export const driveTrasher = () => trasher;

/**
 * Replaces the trash function (the tests pass a fake).
 *
 * Takes:
 *   fn - a function with the same shape as driveTrasher() returns, or null
 */
export function setDriveTrasher(fn) {
  trasher = fn;
}
