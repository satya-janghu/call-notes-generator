#!/usr/bin/env node
/**
 * Call Notes Generator - CLI Entry Point
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { type Server } from 'http';
import open from 'open';
import { startServer } from '../src/server.js';
import { validateEnv, CONFIG } from '../src/config.js';

// Server reference for graceful shutdown
let httpServer: Server | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env in the project root
const envPath = resolve(process.cwd(), '.env');
config({ path: envPath });

// Validate environment configuration
const envStatus = validateEnv();
if (envStatus.warnings.length > 0) {
  console.log('\nConfiguration warnings:');
  for (const warning of envStatus.warnings) {
    console.log(`  - ${warning}`);
  }
  console.log('');
}

// Get port from config
const port = CONFIG.server.port;

console.log('Starting Call Notes Generator...');

// Start the server
startServer(port)
  .then(async ({ port: actualPort, server }) => {
    httpServer = server; // Store for graceful shutdown
    const url = `http://localhost:${actualPort}`;
    console.log(`\nCall Notes Generator is ready at ${url}`);
    console.log('Opening browser...\n');

    // Open browser
    try {
      await open(url);
    } catch (error) {
      console.log(`Could not open browser automatically. Please visit ${url} manually.`);
    }

    console.log('Press Ctrl+C to stop the server.');
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

// Graceful shutdown function
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  if (httpServer) {
    httpServer.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });

    // Force exit after 5 seconds if connections don't close
    setTimeout(() => {
      console.log('Forcing exit after timeout...');
      process.exit(1);
    }, 5000).unref(); // unref() allows exit if this is only thing left
  } else {
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
