/**
 * Environment Configuration and Validation
 * 
 * This module handles loading and validating environment variables,
 * providing safe defaults and clear error messages for missing required values.
 */

require('dotenv').config();

/**
 * Validates that a required environment variable is set
 * 
 * @param {string} varName - The name of the environment variable
 * @param {string} description - Human-readable description of the variable
 * @throws {Error} If the required variable is not set
 */
function requireEnvVar(varName, description) {
  const value = process.env[varName];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${varName}\n` +
      `Description: ${description}\n` +
      `Please set this in your .env file.`
    );
  }
  return value.trim();
}

/**
 * Gets an optional environment variable with a default value
 * 
 * @param {string} varName - The name of the environment variable
 * @param {*} defaultValue - The default value if not set
 * @returns {*} The environment variable value or default
 */
function getEnvVar(varName, defaultValue) {
  const value = process.env[varName];
  return value && value.trim() !== '' ? value.trim() : defaultValue;
}

/**
 * Application configuration object
 * Loads and validates all required environment variables
 */
const config = {
  /**
   * Port number for the Express server
   * @type {number}
   */
  port: parseInt(getEnvVar('PORT', '3000'), 10),

  /**
   * MyAnimeList API Client ID (required to use the MAL service)
   * Register an app at https://myanimelist.net/apiconfig to obtain one.
   * @type {string|null}
   */
  malClientId: getEnvVar('MAL_CLIENT_ID', null),

  /**
   * Node environment (development, production, etc.)
   * @type {string}
   */
  nodeEnv: getEnvVar('NODE_ENV', 'development'),

  /**
   * Whether the app is running in development mode
   * @type {boolean}
   */
  isDevelopment: getEnvVar('NODE_ENV', 'development') === 'development',

  /**
   * AniList OAuth Client ID (for progress updates)
   * @type {string|null}
   */
  anilistClientId: getEnvVar('ANILIST_CLIENT_ID', null),

  /**
   * AniList OAuth Client Secret (for progress updates)
   * @type {string|null}
   */
  anilistClientSecret: getEnvVar('ANILIST_CLIENT_SECRET', null),

  /**
   * MAL OAuth Client ID (for progress updates)
   * @type {string|null}
   */
  malOauthClientId: getEnvVar('MAL_OAUTH_CLIENT_ID', null),

  /**
   * MAL OAuth Client Secret (for progress updates)
   * @type {string|null}
   */
  malOauthClientSecret: getEnvVar('MAL_OAUTH_CLIENT_SECRET', null)
};

/**
 * Validates the entire configuration
 * Checks for logical errors and invalid values
 * 
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
  // Validate port number
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}. Must be between 1 and 65535.`);
  }

  console.log('✓ Configuration validated successfully');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - MAL Client ID: ${config.malClientId ? 'set' : 'not set (MAL service disabled)'}`);
  console.log(`  - AniList OAuth: ${config.anilistClientId ? 'configured' : 'not configured (no ANILIST_CLIENT_ID)'}`);
  console.log(`  - MAL OAuth: ${config.malOauthClientId ? 'configured' : 'not configured (progress updates disabled)'}`);
}

// Validate configuration on module load
try {
  validateConfig();
} catch (error) {
  console.error('\n❌ Configuration Error:');
  console.error(error.message);
  console.error('\nPlease check your .env file and try again.\n');
  process.exit(1);
}

module.exports = config;

// Made with Bob
