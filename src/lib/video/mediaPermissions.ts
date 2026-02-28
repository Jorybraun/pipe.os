// ============================================================================
// Media Permissions Helper
// ============================================================================

export interface MediaPermissionResult {
  stream: MediaStream | null;
  error: 'denied' | 'notfound' | 'unknown' | null;
}

/**
 * Requests access to the user's camera and microphone.
 * Returns a stream on success, or a typed error on failure.
 */
export async function requestMediaPermissions(
  video = true,
  audio = true
): Promise<MediaPermissionResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    return { stream, error: null };
  } catch (err: unknown) {
    if (err instanceof DOMException) {
      if (
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError'
      ) {
        console.error('[mediaPermissions] Camera/mic denied by user');
        return { stream: null, error: 'denied' };
      }
      if (
        err.name === 'NotFoundError' ||
        err.name === 'DevicesNotFoundError'
      ) {
        console.error('[mediaPermissions] No camera/mic hardware found');
        return { stream: null, error: 'notfound' };
      }
    }
    console.error('[mediaPermissions] Unexpected error:', err);
    return { stream: null, error: 'unknown' };
  }
}

/**
 * Stops all tracks on a MediaStream and releases the hardware.
 */
export function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Returns available camera and microphone device labels.
 * Requires at least one active stream to get labels (browser security).
 */
export async function enumerateDevices(): Promise<{
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    microphones: devices.filter((d) => d.kind === 'audioinput'),
  };
}
