import { Request, Response, NextFunction } from "express";

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes (4-argument signature).
 */
export function globalErrorHandler(err: any, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  const status: number = err.status || err.statusCode || 500;
  const message: string = err.message || "Internal Server Error";

  if (status >= 500) {
    console.error(`[ERROR] ${status}:`, err);
  }

  res.status(status).json({ message });
}
