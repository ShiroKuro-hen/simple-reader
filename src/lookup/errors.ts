/** Thrown by lookup() only when nothing at all could be found. `offline`: no connection; `network`: a provider failed or refused; `empty`: nothing selected. */
export class LookupError extends Error {
  constructor(
    readonly code: 'offline' | 'network' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'LookupError';
  }
}
