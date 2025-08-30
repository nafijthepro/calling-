const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Enhanced security middleware
const securityMiddleware = (app) => {
  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        mediaSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));

  // Rate limiting for different endpoints
  const createLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: message });
    }
  });

  // Apply different rate limits
  app.use('/api/auth/login', createLimiter(15 * 60 * 1000, 5, 'Too many login attempts'));
  app.use('/api/auth/register', createLimiter(60 * 60 * 1000, 3, 'Too many registration attempts'));
  app.use('/api/', createLimiter(15 * 60 * 1000, 100, 'Too many API requests'));
};

module.exports = securityMiddleware;