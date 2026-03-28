/**
 * Amplify StorageProvider implementation.
 *
 * Wraps `uploadData` and `getUrl` from `aws-amplify/storage` and maps them
 * to the provider-agnostic StorageProvider interface.
 *
 * Consumer code never imports from this file directly — use `useStorage()` instead.
 */

import { uploadData, getUrl } from 'aws-amplify/storage';
import type { TransferProgressEvent } from '@aws-amplify/storage';
import type {
  StorageProvider,
  UploadInput,
  GetUrlInput,
  GetUrlResult,
} from '../types';

/**
 * AmplifyStorageProvider — S3-backed storage via Amplify.
 */
export const AmplifyStorageProvider: StorageProvider = {
  /**
   * Upload a file or blob to S3.
   *
   * Delegates to `uploadData(...).result` (the Amplify v6 Promise-based API).
   * The `onProgress` callback is forwarded as-is to the underlying SDK.
   */
  upload: async (input: UploadInput): Promise<{ path: string }> => {
    // Bridge our { loaded, total } progress interface to Amplify's TransferProgressEvent
    const onProgress = input.onProgress
      ? (event: TransferProgressEvent): void => {
          input.onProgress?.({
            loaded: event.transferredBytes,
            total: event.totalBytes ?? event.transferredBytes,
          });
        }
      : undefined;

    const result = await uploadData({
      path: input.path,
      data: input.data,
      options: {
        ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      },
    }).result;

    return { path: result.path };
  },

  /**
   * Generate a pre-signed S3 download URL.
   *
   * Defaults to 3600s (1 hour) if `expiresIn` is not specified.
   */
  getUrl: async (input: GetUrlInput): Promise<GetUrlResult> => {
    const result = await getUrl({
      path: input.path,
      options: { expiresIn: input.options?.expiresIn ?? 3600 },
    });

    return {
      url: result.url,
      expiresAt: result.expiresAt,
    };
  },
};
