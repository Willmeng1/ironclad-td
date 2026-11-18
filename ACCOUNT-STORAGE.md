# Account storage

Accounts and progress are saved on every successful signup and progress-save request. Sessions are temporary: after a server restart, players need to log in again.

## Supabase / PostgreSQL

Set `DATABASE_URL` to the private Supabase Session pooler connection string in the Render service's environment settings. Substitute the database password, URL-encoding any special characters. The server connects with TLS and creates `ironclad_private.accounts` on startup. This private schema must not be exposed through Supabase's Data API. If the configured database is unreachable, the server fails startup rather than silently falling back to temporary local storage. Keep the connection string private and never commit it to GitHub.

If the Supabase certificate is not trusted by Node's default certificate store, download the server root certificate from Supabase's Database Settings and set its full PEM text as `SUPABASE_DB_CA_CERT` in Render. Certificate and hostname verification remain enabled. The CA variable accepts either actual newlines or literal `\n` separators.

The database starts empty: existing local accounts are not imported automatically. Accounts already lost from Render's temporary filesystem cannot be recovered through this setup. Supabase Free projects can pause after inactivity and are subject to free-plan limits; plan backups accordingly.

## Local file mode

When `DATABASE_URL` is not set, the default database is `~/.ironclad-td/accounts.json`, outside the publicly served game directory. Passwords are salted and hashed with scrypt in both modes. File writes use an atomic replacement, and the previous database is retained as `accounts.json.bak`. Back up this directory to protect accounts against disk failure or deletion. Keep both files private. Local file mode is not persistent on a free Render web service.

Set `IRONCLAD_ACCOUNT_FILE` to an absolute private path to override storage, including for isolated tests. Never point it inside the public game directory. Run only one server process against each database. A malformed database stops startup instead of silently resetting accounts.

Accounts lost before persistent storage was added cannot be recovered from this database. Browser-cached progress, if still present, must be recovered separately; creating a replacement account does not automatically restore it.
