/**
 * Express server setup
 */

import express from 'express';
import { type Server } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import { getCredentialStatus } from './services/basecamp/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp() {
  const app = express();

  // Middleware with size limits for security
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Static files from public directory
  // Use process.cwd() to resolve from project root, works in both dev and compiled builds
  const publicPath = resolve(process.cwd(), 'public');
  app.use(express.static(publicPath));

  // API routes
  app.use('/auth', authRoutes);
  app.use('/api', apiRoutes);

  // Root route - check credentials and redirect appropriately
  app.get('/', (req, res) => {
    const status = getCredentialStatus();
    if (!status.isComplete) {
      res.redirect('/setup.html');
    } else {
      res.sendFile(resolve(publicPath, 'index.html'));
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

export function startServer(port: number): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const app = createApp();
    let resolved = false; // Track if we've already resolved (prevents race condition)

    const server = app.listen(port, '127.0.0.1', () => {
      if (resolved) return; // Don't resolve twice
      resolved = true;
      const address = server.address();
      // address can be null if server is closed, or a string for pipes
      const actualPort = address && typeof address === 'object' ? address.port : port;
      console.log(`Call Notes Generator running at http://localhost:${actualPort}`);
      resolve({ port: actualPort, server });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolved = true; // Prevent listen callback from resolving
        console.log(`Port ${port} is in use, trying ${port + 1}...`);
        server.close();
        startServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(error);
      }
    });
  });
}
