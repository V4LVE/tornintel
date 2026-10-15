//  @ts-check

/** @type {import('prettier').Config} */
const config = {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  // The working copy uses CRLF (core.autocrlf) while the index stores LF, so keep whatever line endings a file already has.
  endOfLine: 'auto',
}

export default config
