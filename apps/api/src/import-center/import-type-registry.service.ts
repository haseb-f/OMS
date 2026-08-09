import { Injectable, NotFoundException } from '@nestjs/common';
import type { ImportTypeHandler } from './import-type.interface';

/**
 * Import Center (TASK-056 Part 2) — "every type is plug-in based." Each
 * `ImportTypeHandler` registers itself here at module init (mirroring
 * `PostingEngineService.registerProvider`); this service never imports a
 * business module and knows nothing about Customers, Products, or any
 * other domain — it only looks types up by key.
 */
@Injectable()
export class ImportTypeRegistryService {
  private readonly handlers = new Map<string, ImportTypeHandler>();

  register(handler: ImportTypeHandler) {
    this.handlers.set(handler.type, handler);
  }

  list(): ImportTypeHandler[] {
    return [...this.handlers.values()];
  }

  get(type: string): ImportTypeHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new NotFoundException(`No Import Type registered for "${type}".`);
    }
    return handler;
  }
}
