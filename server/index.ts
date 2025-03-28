import express, { type Request, Response, NextFunction } from "express";
// Changed to use the updated routes with NOWPayments removed
import { registerRoutes } from "../new-routes";
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors';
import * as pathModule from 'path';

const app = express();
// Allow any origin in development to help with Replit preview
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://chickfarms.replit.app', 'https://chickfarms.com'] 
    : true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Make sure we're setting the correct Content-Type header for API responses
  // This middleware needs to be before registerRoutes to properly handle the API responses
  app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
  });

  const server = await registerRoutes(app);
  
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Server error:", err);
    
    // Make sure the content type is set to application/json for API error responses
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000 for Replit compatibility
  // This serves both the API and the client
  // Replit specifically looks for port 5000 in our configuration
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  
  console.log("Starting server on port", port);
  
  // Add a test route that's easy to access
  app.get('/test', (req, res) => {
    res.send('Server is working!');
  });
  
  // Add a route for Replit health checks
  app.get('/health', (req, res) => {
    res.status(200).send('Healthy');
  });
  
  // Explicitly serve our static HTML file for the root path
  app.get('/', (req, res) => {
    res.sendFile(pathModule.join(__dirname, '../client/public/index.html'));
  });
  
  // But let other HTML requests go to Vite, ensuring API requests are excluded
  app.get(/^(?!\/api\/).*$/, (req, res, next) => {
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return next();
    }
    
    // For non-HTML requests, try static files
    express.static(pathModule.join(__dirname, '../client/public'))(req, res, next);
  });
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    console.log(`Server is listening on http://0.0.0.0:${port}`);
    console.log(`Environment: ${app.get("env")}`);
    
    const replSlug = process.env.REPL_SLUG;
    const replOwner = process.env.REPL_OWNER;
    
    if (replSlug && replOwner) {
      console.log(`Open in browser: https://${replSlug}.${replOwner}.repl.co`);
    } else {
      console.log(`Open in browser: http://localhost:${port}`);
    }
  });
})();
