data.enc.json is an AES-256-GCM encrypted, gzipped payload.
Without the passphrase it is 200-odd KB of noise.

Rebuild it with:  FINANCE_PASSPHRASE='…' npm run finance
Source data lives in finance-private/ and is gitignored.
