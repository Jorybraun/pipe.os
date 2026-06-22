export function getSchedulingOAuthRedirectUri(location: Pick<Location, 'protocol' | 'hostname' | 'port' | 'origin'> = window.location): string {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const isLocal = localHosts.has(location.hostname);
  const origin = isLocal ? `${location.protocol}//localhost${location.port ? `:${location.port}` : ''}` : location.origin;
  return `${origin}/interviews`;
}
