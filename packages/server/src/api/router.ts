import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { registerRecallRoutes } from './recall.js';
import { registerIngestRoutes } from './ingest.js';
import { registerFlushRoutes } from './flush.js';
import { registerSearchRoutes } from './search.js';
import { registerMemoriesRoutes } from './memories.js';
import { registerRelationsRoutes } from './relations.js';
import { registerLifecycleRoutes } from './lifecycle.js';
import { registerSystemRoutes } from './system.js';
import { registerMCPRoutes } from './mcp.js';
import { registerImportExportRoutes } from './import-export.js';
import { registerAgentRoutes } from './agents.js';
import { registerExtractionLogRoutes } from './extraction-logs.js';

export function registerAllRoutes(app: FastifyInstance, cortex: CortexApp): void {
  registerRecallRoutes(app, cortex);
  registerIngestRoutes(app, cortex);
  registerFlushRoutes(app, cortex);
  registerSearchRoutes(app, cortex);
  registerMemoriesRoutes(app, cortex);
  registerRelationsRoutes(app);
  registerLifecycleRoutes(app, cortex);
  registerSystemRoutes(app, cortex);
  registerMCPRoutes(app, cortex);
  registerImportExportRoutes(app, cortex);
  registerAgentRoutes(app);
  registerExtractionLogRoutes(app);
}
