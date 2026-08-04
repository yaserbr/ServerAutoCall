const express = require("express");
const bcrypt = require("bcrypt");

/**
 * Creates and configures the Auth and Pairing router.
 * Uses dependency injection to access models, middlewares, and helper utilities.
 */
function createAuthRouter({
  User,
  requireAuth,
  getAdminSetupKey,
  isAuthEnabled,
  respondAuthDisabled,
  parseRequestBodyObject,
  parseUsername,
  parsePassword,
  parseRegistrationPassword,
  logSecurityEvent,
  BCRYPT_SALT_ROUNDS,
  signAccessToken,
  mapUserForResponse,
  handleServerError,
  normalizeAuthUserId,
  createPairingTokenForUser,
  resolvePublicServerUrl,
  PAIRING_TOKEN_TYPE,
  PAIRING_TOKEN_TTL_MS,
  setAccessTokenCookie,
  clearAccessTokenCookie,
  isSecretEqual,
  createPairingQrDataUrl
}) {
  const router = express.Router();

  router.post("/auth/register", async (req, res) => {
    try {
      const adminSetupKey = getAdminSetupKey();
      const providedSetupKey =
        typeof req.headers?.["x-admin-setup-key"] === "string"
          ? req.headers["x-admin-setup-key"].trim()
          : "";

      if (!adminSetupKey || !isSecretEqual(providedSetupKey, adminSetupKey)) {
        return res.status(403).json({ error: "Registration is disabled" });
      }

      if (!isAuthEnabled()) {
        return respondAuthDisabled(res);
      }

      const payload = parseRequestBodyObject(req.body);
      const username = parseUsername(payload.username);
      const password = parseRegistrationPassword(payload.password);

      if (!username || !password) {
        logSecurityEvent("auth_register_validation_failed", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method
        });
        return res.status(400).json({
          error: "username and a password of at least 12 characters are required"
        });
      }

      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(409).json({ error: "username already in use" });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
      const user = await User.create({
        username,
        passwordHash
      });

      const accessToken = signAccessToken(user);
      if (!accessToken) {
        return respondAuthDisabled(res);
      }
      setAccessTokenCookie(req, res, accessToken);

      return res.status(201).json({
        accessToken,
        user: mapUserForResponse(user)
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: "username already in use" });
      }
      return handleServerError(res, error, "POST /auth/register");
    }
  });

  router.post("/auth/login", async (req, res) => {
    try {
      if (!isAuthEnabled()) {
        return respondAuthDisabled(res);
      }

      const payload = parseRequestBodyObject(req.body);
      const username = parseUsername(payload.username);
      const password = parsePassword(payload.password);

      if (!username || !password) {
        logSecurityEvent("auth_login_validation_failed", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method
        });
        return res.status(400).json({ error: "username and password are required" });
      }

      const user = await User.findOne({ username });
      if (!user) {
        return res.status(401).json({ error: "invalid username or password" });
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        return res.status(401).json({ error: "invalid username or password" });
      }

      const accessToken = signAccessToken(user);
      if (!accessToken) {
        return respondAuthDisabled(res);
      }
      setAccessTokenCookie(req, res, accessToken);

      return res.json({
        accessToken,
        user: mapUserForResponse(user)
      });
    } catch (error) {
      return handleServerError(res, error, "POST /auth/login");
    }
  });

  router.get("/auth/me", requireAuth, async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      return res.json({ user: mapUserForResponse(user) });
    } catch (error) {
      return handleServerError(res, error, "GET /auth/me");
    }
  });

  router.post("/auth/logout", (_req, res) => {
    clearAccessTokenCookie(_req, res);
    return res.status(204).end();
  });

  router.get("/pairing/qr", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const userExists = await User.exists({ _id: currentUserId });
      if (!userExists) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const createdToken = await createPairingTokenForUser(currentUserId);
      const serverUrl = resolvePublicServerUrl(req);
      const qrPayload = {
        type: PAIRING_TOKEN_TYPE,
        pairingToken: createdToken.pairingToken,
        serverUrl
      };
      const qrDataUrl = await createPairingQrDataUrl(qrPayload);

      return res.json({
        ...qrPayload,
        manualPairingCode: createdToken.manualPairingCode,
        qrDataUrl,
        expiresAt: createdToken.expiresAt.toISOString(),
        expiresInSeconds: Math.floor(PAIRING_TOKEN_TTL_MS / 1000)
      });
    } catch (error) {
      return handleServerError(res, error, "GET /pairing/qr");
    }
  });

  return router;
}

module.exports = createAuthRouter;
