import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 does NOT catch errors thrown in async handlers — an unhandled
// rejection there crashes the whole process. Wrapping each async handler so it
// forwards rejections to next() lets the error-handling middleware turn a failed
// query into a 500 response instead of taking the server down.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
