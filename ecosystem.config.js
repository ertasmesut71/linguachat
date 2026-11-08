/**
 * PM2 Process Manager Configuration
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 logs linguachat
 *   pm2 restart linguachat
 *   pm2 stop linguachat
 *   pm2 save && pm2 startup   # persist across reboots
 */
module.exports = {
  apps: [
    {
      name: "linguachat",
      script: "server/index.js",
      instances: 1,               // Set to "max" with Redis pub/sub for WS scaling
      exec_mode: "fork",          // Change to "cluster" with Redis adapter
      watch: false,
      max_memory_restart: "500M",

      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },

      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,

      // Environment overrides
      env_production: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
      },
    },
  ],
};
