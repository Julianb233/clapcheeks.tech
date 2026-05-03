// Clapcheeks PM2 ecosystem — self-contained, NOT part of /home/dev/ai-acrobatics-fleet.
// Run from this directory: `pm2 start ecosystem.config.cjs`
// Reload after edits: `pm2 reload ecosystem.config.cjs`
// Status: `pm2 list | grep clapcheeks`
//
// Linear: AI-9196 — moved off Fly.io trial onto VPS to drop hosting subscription.

const path = require('path');
const BASE = __dirname;

const COMMON = {
    max_memory_restart: '512M',
    kill_timeout: 5000,
    listen_timeout: 15000,
    max_restarts: 15,
    min_uptime: '30s',
    exp_backoff_restart_delay: 500,
    autorestart: true,
};

module.exports = {
    apps: [
        {
            name: 'clapcheeks-api',
            script: 'server.js',
            cwd: path.join(BASE, 'api'),
            interpreter: 'node',
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
            },
            // server.js loads dotenv from cwd, so api/.env is picked up automatically
            ...COMMON,
        },
        {
            name: 'clapcheeks-ai',
            script: '.venv/bin/uvicorn',
            args: 'main:app --host 127.0.0.1 --port 8000',
            cwd: path.join(BASE, 'ai'),
            interpreter: 'none',
            env: {
                PYTHONUNBUFFERED: '1',
            },
            // main.py calls load_dotenv() from cwd, so ai/.env is picked up automatically
            ...COMMON,
        },
    ],
};
