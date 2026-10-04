import { clone } from '../util/clone.js';
import type {
  BaselineSnapshot,
  CosmosEntity,
  Property,
  Relationship,
} from '../types.js';

export interface EntitySearchHit {
  id: string;
  name: string;
  type: string;
  score: number;
  summary: string;
}

export interface GraphContext {
  baselineId: string;
  entityCount: number;
  relationshipCount: number;
  focusEntityId?: string;
  domainHints: string[];
}

export class WorldGraph {
  private _baselineId: string;
  private _version: string;
  private entities = new Map<string, CosmosEntity>();
  private relationships: Relationship[] = [];

  get baselineId(): string {
    return this._baselineId;
  }

  get version(): string {
    return this._version;
  }

  constructor(snapshot?: BaselineSnapshot) {
    this._baselineId = snapshot?.id ?? 'empty';
    this._version = snapshot?.version ?? '0';
    if (snapshot) {
      this.loadBaseline(snapshot);
    }
  }

  loadBaseline(json: BaselineSnapshot): void {
    this._baselineId = json.id;
    this._version = json.version;
    this.entities.clear();
    this.relationships = [];
    for (const entity of json.entities) {
      this.entities.set(entity.id, clone(entity));
    }
    this.relationships = json.relationships.map((r) => clone(r));
  }

  toSnapshot(): BaselineSnapshot {
    return {
      id: this.baselineId,
      version: this.version,
      entities: [...this.entities.values()].map((e) => clone(e)),
      relationships: this.relationships.map((r) => clone(r)),
    };
  }

  getEntity(id: string): CosmosEntity | undefined {
    const entity = this.entities.get(id);
    return entity ? clone(entity) : undefined;
  }

  setEntity(entity: CosmosEntity): void {
    this.entities.set(entity.id, clone(entity));
  }

  getRelationships(): Relationship[] {
    return this.relationships.map((r) => clone(r));
  }

  searchEntities(query: string, domain?: string): EntitySearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: EntitySearchHit[] = [];
    for (const entity of this.entities.values()) {
      if (domain && !entity.type.startsWith(domain) && entity.type !== domain) {
        const domainMatch =
          entity.properties.domain?.value === domain ||
          entity.id.includes(domain);
        if (!domainMatch && !entity.type.includes(domain)) continue;
      }
      const name = entity.name.toLowerCase();
      const id = entity.id.toLowerCase();
      let score = 0;
      if (id === q) score = 100;
      else if (name === q) score = 90;
      else if (name.startsWith(q)) score = 70;
      else if (name.includes(q) || id.includes(q)) score = 50;
      else if (entity.type.toLowerCase().includes(q)) score = 30;
      else continue;

      const propKeys = Object.keys(entity.properties).slice(0, 3).join(', ');
      hits.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        score,
        summary: `${entity.type}${propKeys ? ` · ${propKeys}` : ''}`,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  getContext(focusEntityId?: string): GraphContext {
    const focus = focusEntityId ? this.entities.get(focusEntityId) : undefined;
    const domainHints = new Set<string>();
    for (const entity of this.entities.values()) {
      domainHints.add(entity.type.split('.')[0] ?? entity.type);
    }
    if (focus) {
      domainHints.add(focus.type);
    }
    return {
      baselineId: this.baselineId,
      entityCount: this.entities.size,
      relationshipCount: this.relationships.length,
      focusEntityId,
      domainHints: [...domainHints],
    };
  }

  patchProperties(
    entityId: string,
    patches: Record<string, Property<unknown>>,
  ): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    for (const [key, prop] of Object.entries(patches)) {
      entity.properties[key] = clone(prop);
    }
    return true;
  }

  clone(): WorldGraph {
    const g = new WorldGraph();
    g.loadBaseline(this.toSnapshot());
    return g;
  }
}
