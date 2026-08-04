const { isValidAndroidPackageName } = require("../domain/androidPackage");

function normalizeOpenAppAliasKey(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOpenAppAliasCandidates(value) {
  const normalized = normalizeOpenAppAliasKey(value);
  if (!normalized) return [];

  const withoutGenericWords = normalized
    .replace(/\b(app|application|android|mobile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = new Set();
  const addCandidate = (candidateValue) => {
    if (!candidateValue) return;
    const compact = candidateValue.replace(/\s+/g, "");
    if (candidateValue) candidates.add(candidateValue);
    if (compact) candidates.add(compact);
  };

  addCandidate(normalized);
  addCandidate(withoutGenericWords);
  return [...candidates];
}

function createOpenAppResolver(aliasDefinitions) {
  const aliasMap = new Map();

  for (const definition of aliasDefinitions) {
    const packageName = String(definition.packageName || "").trim().toLowerCase();
    if (!packageName) continue;

    const aliases = Array.isArray(definition.aliases) ? definition.aliases : [];
    for (const alias of aliases) {
      for (const key of buildOpenAppAliasCandidates(alias)) {
        aliasMap.set(key, { packageName, matchedAlias: alias });
      }
    }

    aliasMap.set(packageName, { packageName, matchedAlias: packageName });
    aliasMap.set(packageName.replace(/\./g, ""), {
      packageName,
      matchedAlias: packageName
    });
  }

  return function resolveOpenAppTarget(value) {
    const normalizedAppName =
      typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

    if (!normalizedAppName) {
      return {
        normalizedAppName: "",
        resolvedPackageName: null,
        matchedAlias: null,
        usedFallback: true
      };
    }

    if (isValidAndroidPackageName(normalizedAppName)) {
      return {
        normalizedAppName,
        resolvedPackageName: normalizedAppName.toLowerCase(),
        matchedAlias: "direct_package_name",
        usedFallback: false
      };
    }

    for (const candidate of buildOpenAppAliasCandidates(normalizedAppName)) {
      const resolved = aliasMap.get(candidate);
      if (resolved?.packageName) {
        return {
          normalizedAppName,
          resolvedPackageName: resolved.packageName,
          matchedAlias: resolved.matchedAlias ?? null,
          usedFallback: false
        };
      }
    }

    return {
      normalizedAppName,
      resolvedPackageName: null,
      matchedAlias: null,
      usedFallback: true
    };
  };
}

module.exports = createOpenAppResolver;
