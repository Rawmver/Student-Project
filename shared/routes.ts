import { z } from 'zod';
import { createGroupRequestSchema, groups, members, topics } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  conflict: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  groups: {
    create: {
      method: 'POST' as const,
      path: '/api/groups' as const,
      input: createGroupRequestSchema,
      responses: {
        201: z.object({
            id: z.number(),
            message: z.string()
        }),
        400: errorSchemas.validation,
        409: errorSchemas.conflict, // For duplicate IDs
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/groups' as const,
      responses: {
        200: z.array(z.custom<typeof groups.$inferSelect & { members: typeof members.$inferSelect[], topic: typeof topics.$inferSelect | null }>()),
        401: errorSchemas.unauthorized,
      },
    },
  },
  topics: {
    list: {
      method: 'GET' as const,
      path: '/api/topics' as const,
      responses: {
        200: z.array(z.custom<typeof topics.$inferSelect>()),
      },
    },
  },
  stats: {
    get: {
      method: 'GET' as const,
      path: '/api/stats' as const,
      responses: {
        200: z.object({
          totalGroups: z.number(),
          totalStudents: z.number(),
        }),
        401: errorSchemas.unauthorized,
      },
    },
  },
};

// Helper for URL building
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
