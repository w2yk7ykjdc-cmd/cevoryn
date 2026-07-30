// Test-only stub for the `server-only` package. It normally throws when
// resolved outside of a bundler that sets the "react-server" condition
// (Next.js does this at build time); Vitest doesn't, so we alias it here to
// a no-op instead of pulling test config into carrying that condition
// through every dependency's resolution.
export {};
