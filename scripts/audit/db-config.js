/**
 * Shared MySQL configuration for the audit scripts.
 *
 * The password is NEVER stored in this repository — it is read from the
 * environment:
 *
 *   set AUDIT_DB_PASSWORD=<password>        # Windows CMD
 *   export AUDIT_DB_PASSWORD=<password>      # bash / zsh
 *   $env:AUDIT_DB_PASSWORD = '<password>'    # PowerShell
 *
 * Host / user / database keep their historical defaults and may be
 * overridden with AUDIT_DB_HOST / AUDIT_DB_USER / AUDIT_DB_NAME.
 */
const AUDIT_DB_CONFIG = {
  host: process.env.AUDIT_DB_HOST || '127.0.0.1',
  user: process.env.AUDIT_DB_USER || 'root',
  password: process.env.AUDIT_DB_PASSWORD || '',
  database: process.env.AUDIT_DB_NAME || 'piyin_deploy_test',
  charset: 'utf8mb4',
};

/**
 * Fail fast when no password was supplied. Without this guard an empty
 * password surfaces as an opaque "ER_ACCESS_DENIED_ERROR" that looks like a
 * MySQL problem rather than a missing environment variable.
 */
function requireAuditDbPassword() {
  if (AUDIT_DB_CONFIG.password) return AUDIT_DB_CONFIG;
  console.error(
    'AUDIT_DB_PASSWORD is required.\n' +
      '  set AUDIT_DB_PASSWORD=<password>        # Windows CMD\n' +
      '  export AUDIT_DB_PASSWORD=<password>      # bash / zsh\n' +
      '  $env:AUDIT_DB_PASSWORD = "<password>"    # PowerShell\n' +
      'Never commit the password — put it in your shell profile or .env.local.',
  );
  process.exit(1);
}

module.exports = { AUDIT_DB_CONFIG, requireAuditDbPassword };
