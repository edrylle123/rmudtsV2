// CRA dev-server proxy (loaded automatically by react-scripts).
// Attachments are fetched same-origin (/uploads/...) so the browser never
// performs a cross-origin request — avoiding CORS entirely in development.
// In production the Express backend serves both the SPA and /uploads, so
// same-origin requests keep working there too.
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api/file-proxy",
    createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
    })
  );
  app.use(
    "/api/pdf-viewer",
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
