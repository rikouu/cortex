/**
 * Neo4j graph database connection and relation queries.
 * Replaces SQLite-based relation storage with native graph operations.
 */
import { createHash } from 'crypto';
import neo4j, { Driver, Session } from 'neo4j-driver';

let driver: Driver | null = null;

export function initNeo4j(): Driver | null {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !password) {
    console.log('[neo4j] NEO4J_URI or NEO4J_PASSWORD not set — graph features disabled');
    return null;
  }

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 5000,
  });

  console.log(`[neo4j] Connected to ${uri}`);
  return driver;
}

export function getDriver(): Driver | null {
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// ── Schema setup ──

export async function ensureSchema(): Promise<void> {
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run('CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE');
    await session.run('CREATE INDEX entity_agent IF NOT EXISTS FOR (e:Entity) ON (e.agent_id)');
    console.log('[neo4j] Schema constraints ensured');
  } finally {
    await session.close();
  }
}

// ── Relation CRUD ──

export interface GraphRelation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  agent_id: string;
  source: string;
  source_memory_id?: string;
  extraction_count: number;
  expired: number;
  created_at: string;
  updated_at: string;
}

export function buildRelationSemanticId(rel: Pick<GraphRelation, 'subject' | 'predicate' | 'object' | 'agent_id'>): string {
  return createHash('sha1')
    .update(`${rel.agent_id}\u0000${rel.subject}\u0000${rel.predicate}\u0000${rel.object}`)
    .digest('hex');
}

export async function upsertRelation(rel: Omit<GraphRelation, 'created_at' | 'updated_at'>): Promise<void> {
  if (!driver) return;
  const session = driver.session();
  const now = new Date().toISOString();
  const relType = rel.predicate.toUpperCase().replace(/[\s-]/g, '_');
  const semanticId = buildRelationSemanticId(rel);

  try {
    await session.run(`
      MERGE (s:Entity {name: $subject})
      MERGE (o:Entity {name: $object})
    `, {
      subject: rel.subject,
      object: rel.object,
    });

    const existing = await session.run(`
      MATCH (s:Entity {name: $subject})-[r:${relType}]->(o:Entity {name: $object})
      WHERE r.agent_id = $agentId
      RETURN elementId(r) AS element_id
      ORDER BY r.updated_at DESC, r.created_at DESC
    `, {
      subject: rel.subject,
      object: rel.object,
      agentId: rel.agent_id,
    });

    if (existing.records.length > 0) {
      const keepElementId = existing.records[0]!.get('element_id') as string;
      const duplicateElementIds = existing.records.slice(1).map(r => r.get('element_id') as string);

      await session.run(`
        MATCH (s:Entity {name: $subject})-[r:${relType}]->(o:Entity {name: $object})
        WHERE elementId(r) = $keepElementId
        SET r.id = coalesce(r.id, $semanticId),
            r.semantic_id = $semanticId,
            r.confidence = $confidence,
            r.agent_id = $agentId,
            r.source = $source,
            r.source_memory_id = coalesce($sourceMemoryId, r.source_memory_id),
            r.extraction_count = coalesce(r.extraction_count, 0) + $extractionCount,
            r.expired = $expired,
            r.created_at = coalesce(r.created_at, $now),
            r.updated_at = $now
      `, {
        keepElementId,
        semanticId,
        subject: rel.subject,
        object: rel.object,
        confidence: rel.confidence,
        agentId: rel.agent_id,
        source: rel.source,
        sourceMemoryId: rel.source_memory_id || null,
        extractionCount: neo4j.int(rel.extraction_count),
        expired: neo4j.int(rel.expired),
        now,
      });

      if (duplicateElementIds.length > 0) {
        await session.run(`
          MATCH ()-[r]->()
          WHERE elementId(r) IN $duplicateElementIds
          DELETE r
        `, { duplicateElementIds });
      }
      return;
    }

    await session.run(`
      MATCH (s:Entity {name: $subject})
      MATCH (o:Entity {name: $object})
      CREATE (s)-[r:${relType} {
        id: $semanticId,
        semantic_id: $semanticId,
        confidence: $confidence,
        agent_id: $agentId,
        source: $source,
        source_memory_id: $sourceMemoryId,
        extraction_count: $extractionCount,
        expired: $expired,
        created_at: $now,
        updated_at: $now
      }]->(o)
    `, {
      semanticId,
      subject: rel.subject,
      object: rel.object,
      confidence: rel.confidence,
      agentId: rel.agent_id,
      source: rel.source,
      sourceMemoryId: rel.source_memory_id || null,
      extractionCount: neo4j.int(rel.extraction_count),
      expired: neo4j.int(rel.expired),
      now,
    });
  } finally {
    await session.close();
  }
}

export async function listRelations(opts: {
  agentId?: string;
  limit?: number;
  includeExpired?: boolean;
}): Promise<GraphRelation[]> {
  if (!driver) return [];
  const session = driver.session();
  try {
    const conditions: string[] = [];
    const params: Record<string, any> = { limit: neo4j.int(opts.limit || 500) };

    if (!opts.includeExpired) {
      conditions.push('r.expired = 0');
    }
    if (opts.agentId) {
      conditions.push('r.agent_id = $agentId');
      params.agentId = opts.agentId;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await session.run(`
      MATCH (s:Entity)-[r]->(o:Entity)
      ${where}
      RETURN r.id AS id, s.name AS subject, type(r) AS predicate, o.name AS object,
             r.confidence AS confidence, r.agent_id AS agent_id, r.source AS source,
             r.source_memory_id AS source_memory_id, r.extraction_count AS extraction_count,
             r.expired AS expired, r.created_at AS created_at, r.updated_at AS updated_at
      ORDER BY r.updated_at DESC
      LIMIT $limit
    `, params);

    return result.records.map(r => ({
      id: r.get('id'),
      subject: r.get('subject'),
      predicate: r.get('predicate').toLowerCase().replace(/_/g, ' '),
      object: r.get('object'),
      confidence: r.get('confidence') ?? 0.5,
      agent_id: r.get('agent_id') ?? 'default',
      source: r.get('source') ?? 'extraction',
      source_memory_id: r.get('source_memory_id'),
      extraction_count: typeof r.get('extraction_count')?.toNumber === 'function'
        ? r.get('extraction_count').toNumber() : (r.get('extraction_count') ?? 1),
      expired: typeof r.get('expired')?.toNumber === 'function'
        ? r.get('expired').toNumber() : (r.get('expired') ?? 0),
      created_at: r.get('created_at') ?? new Date().toISOString(),
      updated_at: r.get('updated_at') ?? new Date().toISOString(),
    }));
  } finally {
    await session.close();
  }
}

export async function deleteRelation(id: string): Promise<boolean> {
  if (!driver) return false;
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH ()-[r {id: $id}]->() DELETE r RETURN count(r) AS deleted',
      { id }
    );
    return (result.records[0]?.get('deleted')?.toNumber?.() ?? 0) > 0;
  } finally {
    await session.close();
  }
}

// ── Graph traversal for recall enhancement ──

/**
 * Find entities related to the given entity within N hops.
 * Used to enhance recall by discovering indirect associations.
 */
export async function traverseRelations(entityName: string, opts: {
  maxHops?: number;
  minConfidence?: number;
  limit?: number;
  agentId?: string;
}): Promise<{ entity: string; hops: number; path: string[] }[]> {
  if (!driver) return [];
  const session = driver.session();
  const maxHops = opts.maxHops || 2;
  const minConf = opts.minConfidence || 0.5;
  const limit = opts.limit || 30;

  try {
    const agentFilter = opts.agentId
      ? 'AND ALL(rel IN relationships(p) WHERE rel.agent_id = $agentId)'
      : '';

    const result = await session.run(`
      MATCH p=shortestPath((start:Entity {name: $entityName})-[*1..${maxHops}]-(end:Entity))
      WHERE start <> end
        AND ALL(rel IN relationships(p) WHERE rel.confidence >= $minConf AND rel.expired = 0 ${agentFilter})
      WITH end, length(p) AS hops,
           [n IN nodes(p) | n.name] AS pathNodes
      RETURN end.name AS entity, hops, pathNodes AS path
      ORDER BY hops, end.name
      LIMIT $limit
    `, {
      entityName,
      minConf,
      limit: neo4j.int(limit),
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });

    return result.records.map(r => ({
      entity: r.get('entity'),
      hops: typeof r.get('hops')?.toNumber === 'function' ? r.get('hops').toNumber() : r.get('hops'),
      path: r.get('path'),
    }));
  } finally {
    await session.close();
  }
}

/**
 * Find shortest path between two entities.
 */
export async function findShortestPath(from: string, to: string, opts: {
  maxHops?: number;
  agentId?: string;
}): Promise<{ path: { entity?: string; predicate?: string }[]; hops: number }> {
  if (!driver) return { path: [], hops: 0 };
  const session = driver.session();
  const maxHops = opts.maxHops || 5;

  try {
    const result = await session.run(`
      MATCH p=shortestPath((a:Entity {name: $from})-[*1..${maxHops}]-(b:Entity {name: $to}))
      RETURN [n IN nodes(p) | n.name] AS entities,
             [r IN relationships(p) | type(r)] AS predicates,
             length(p) AS hops
    `, { from, to });

    if (result.records.length === 0) return { path: [], hops: 0 };

    const entities: string[] = result.records[0]!.get('entities');
    const predicates: string[] = result.records[0]!.get('predicates');
    const hops = typeof result.records[0]!.get('hops')?.toNumber === 'function'
      ? result.records[0]!.get('hops').toNumber() : result.records[0]!.get('hops');

    const path: { entity?: string; predicate?: string }[] = [];
    for (let i = 0; i < entities.length; i++) {
      path.push({ entity: entities[i]! });
      if (i < predicates.length) {
        path.push({ predicate: predicates[i]!.toLowerCase().replace(/_/g, ' ') });
      }
    }

    return { path, hops };
  } finally {
    await session.close();
  }
}

/**
 * Get graph statistics for dashboard.
 */
export async function getGraphStats(): Promise<{ nodes: number; edges: number; agents: string[] }> {
  if (!driver) return { nodes: 0, edges: 0, agents: [] };
  const session = driver.session();
  try {
    const nodeResult = await session.run('MATCH (n:Entity) RETURN count(n) AS c');
    const edgeResult = await session.run('MATCH ()-[r]->() RETURN count(r) AS c');
    const agentResult = await session.run('MATCH ()-[r]->() RETURN DISTINCT r.agent_id AS agent');

    return {
      nodes: nodeResult.records[0]?.get('c')?.toNumber?.() ?? 0,
      edges: edgeResult.records[0]?.get('c')?.toNumber?.() ?? 0,
      agents: agentResult.records.map(r => r.get('agent')).filter(Boolean),
    };
  } finally {
    await session.close();
  }
}
