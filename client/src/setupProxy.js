// CRA dev-server proxy (loaded automatically by react-scripts).
// Attachments are fetched same-origin (/uploads/...) so the browser never
// performs a cross-origin request — avoiding CORS entirely in development.
// In production the Express backend serves both the SPA and /uploads, so
// same-origin requests keep working there too.
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  // Proxy ALL backend API routes
  app.use(
    "/records",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/login",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/signup",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/refresh-token",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/users",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/offices",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/notifications",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/next-control-number",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/uploads",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/preview-pdf",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
};
