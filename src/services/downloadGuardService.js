const crypto = require("crypto");
const Command = require("../models/Command");
const DownloadQuota = require("../models/DownloadQuota");

const BYTES_PER_MB = 1024 * 1024;
const QUOTA_DOCUMENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function readBoundedIntegerEnvironmentValue(name, defaultValue, minimum, maximum) {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || !rawValue.trim()) return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) return defaultValue;
  return Math.max(minimum, Math.min(maximum, parsed));
}

const DOWNLOAD_LIMITS = Object.freeze({
  deviceDailyBytes:
    readBoundedIntegerEnvironmentValue(
      "DUMMY_DOWNLOAD_DEVICE_DAILY_LIMIT_MB",
      2048,
      10,
      100000
    ) * BYTES_PER_MB,
  ipDailyBytes:
    readBoundedIntegerEnvironmentValue(
      "DUMMY_DOWNLOAD_IP_DAILY_LIMIT_MB",
      5120,
      10,
      250000
    ) * BYTES_PER_MB,
  deviceMaxConcurrent: readBoundedIntegerEnvironmentValue(
    "DUMMY_DOWNLOAD_DEVICE_MAX_CONCURRENT",
    2,
    1,
    10
  ),
  ipMaxConcurrent: readBoundedIntegerEnvironmentValue(
    "DUMMY_DOWNLOAD_IP_MAX_CONCURRENT",
    4,
    1,
    25
  ),
  leaseTtlMs: readBoundedIntegerEnvironmentValue(
    "DUMMY_DOWNLOAD_LEASE_TTL_MS",
    6 * 60 * 60 * 1000,
    5 * 60 * 1000,
    24 * 60 * 60 * 1000
  )
});

function createDownloadError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function buildQuotaDay(now) {
  return now.toISOString().slice(0, 10);
}

function buildIpScopeKey(ip) {
  const normalizedIp = typeof ip === "string" && ip.trim() ? ip.trim() : "unknown";
  const digest = crypto.createHash("sha256").update(normalizedIp).digest("hex");
  return `ip:${digest}`;
}

let quotaModelInitializationPromise = null;

async function ensureQuotaModelInitialized() {
  if (!quotaModelInitializationPromise) {
    quotaModelInitializationPromise = DownloadQuota.init().catch((error) => {
      quotaModelInitializationPromise = null;
      throw error;
    });
  }
  await quotaModelInitializationPromise;
}

async function removeExpiredQuotaLeases(scopeKey, quotaDay, now) {
  await DownloadQuota.updateOne(
    { scopeKey, quotaDay },
    {
      $pull: {
        activeLeases: {
          expiresAt: { $lte: now }
        }
      }
    }
  );
}

async function reserveQuota({
  scopeKey,
  quotaDay,
  requestedBytes,
  maximumBytes,
  maximumConcurrent,
  leaseId,
  leaseExpiresAt,
  quotaExpiresAt
}) {
  if (requestedBytes > maximumBytes) {
    throw createDownloadError(429, "download_quota_exceeded", "Download quota exceeded");
  }

  await removeExpiredQuotaLeases(scopeKey, quotaDay, new Date());

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updatedQuota = await DownloadQuota.findOneAndUpdate(
      {
        scopeKey,
        quotaDay,
        bytesReserved: { $lte: maximumBytes - requestedBytes },
        $expr: {
          $lt: [
            { $size: { $ifNull: ["$activeLeases", []] } },
            maximumConcurrent
          ]
        }
      },
      {
        $inc: { bytesReserved: requestedBytes },
        $push: {
          activeLeases: {
            leaseId,
            expiresAt: leaseExpiresAt
          }
        },
        $set: { expiresAt: quotaExpiresAt }
      },
      { new: true }
    ).select("_id");

    if (updatedQuota) {
      return;
    }

    const existingQuota = await DownloadQuota.findOne({ scopeKey, quotaDay })
      .select("bytesReserved activeLeases")
      .lean();
    if (existingQuota) {
      const bytesReserved = Number(existingQuota.bytesReserved || 0);
      const activeLeaseCount = Array.isArray(existingQuota.activeLeases)
        ? existingQuota.activeLeases.length
        : 0;
      if (
        bytesReserved + requestedBytes > maximumBytes ||
        activeLeaseCount >= maximumConcurrent
      ) {
        throw createDownloadError(429, "download_quota_exceeded", "Download quota exceeded");
      }
      continue;
    }

    try {
      await DownloadQuota.create({
        scopeKey,
        quotaDay,
        bytesReserved: requestedBytes,
        activeLeases: [{ leaseId, expiresAt: leaseExpiresAt }],
        expiresAt: quotaExpiresAt
      });
      return;
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  throw createDownloadError(429, "download_quota_exceeded", "Download quota exceeded");
}

async function releaseQuota({ scopeKey, quotaDay, leaseId, refundBytes }) {
  const safeRefundBytes = Math.max(0, Math.round(Number(refundBytes) || 0));
  await DownloadQuota.updateOne(
    { scopeKey, quotaDay },
    {
      $pull: {
        activeLeases: { leaseId }
      }
    }
  );

  if (safeRefundBytes > 0) {
    await DownloadQuota.updateOne(
      { scopeKey, quotaDay, bytesReserved: { $gte: safeRefundBytes } },
      { $inc: { bytesReserved: -safeRefundBytes } }
    );
  }
}

async function releaseCommandLease(
  commandId,
  leaseId,
  completed,
  bytesSent,
  statusToRestore = null
) {
  const filter = {
    _id: commandId,
    downloadLeaseId: leaseId
  };

  if (completed) {
    await Command.updateOne(
      filter,
      {
        $set: {
          downloadCompletedAt: new Date(),
          downloadBytesSent: bytesSent
        },
        $unset: {
          downloadLeaseId: 1,
          downloadLeaseExpiresAt: 1
        }
      }
    );
    return;
  }

  const rollbackUpdate = {
    $unset: {
      downloadStartedAt: 1,
      downloadCompletedAt: 1,
      downloadBytesSent: 1,
      downloadLeaseId: 1,
      downloadLeaseExpiresAt: 1
    }
  };
  if (["pending", "executing"].includes(statusToRestore)) {
    rollbackUpdate.$set = { status: statusToRestore };
  }

  await Command.updateOne(
    filter,
    rollbackUpdate
  );
}

async function reserveAuthorizedDummyDownload({ device, deviceUid, requestedMb, ip }) {
  if (!device?.ownerUserId) {
    throw createDownloadError(
      403,
      "download_device_not_claimed",
      "Download is not authorized for this device"
    );
  }
  if (!device.ownershipEpoch) {
    throw createDownloadError(
      403,
      "download_not_authorized",
      "Download is not authorized for this device"
    );
  }

  await ensureQuotaModelInitialized();

  const requestedBytes = requestedMb * BYTES_PER_MB;
  const now = new Date();
  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + DOWNLOAD_LIMITS.leaseTtlMs);
  const quotaDay = buildQuotaDay(now);
  const quotaExpiresAt = new Date(now.getTime() + QUOTA_DOCUMENT_TTL_MS);
  const deviceScopeKey = `device:${deviceUid}`;
  const ipScopeKey = buildIpScopeKey(ip);

  const authorizedCommand = await Command.findOneAndUpdate(
    {
      deviceUid,
      ownerUserId: device.ownerUserId,
      deviceOwnershipEpoch: device.ownershipEpoch,
      action: "download_data",
      downloadSizeMb: requestedMb,
      status: { $in: ["pending", "executing"] },
      downloadCompletedAt: null,
      $or: [
        { downloadLeaseExpiresAt: null },
        { downloadLeaseExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: "executing",
        downloadStartedAt: now,
        downloadLeaseId: leaseId,
        downloadLeaseExpiresAt: leaseExpiresAt
      },
      $unset: {
        downloadCompletedAt: 1,
        downloadBytesSent: 1
      }
    },
    {
      sort: { createdAt: 1, _id: 1 },
      new: false
    }
  ).select("_id status");

  if (!authorizedCommand) {
    throw createDownloadError(
      403,
      "download_command_missing",
      "Download is not authorized for this device"
    );
  }

  let deviceQuotaReserved = false;
  let ipQuotaReserved = false;

  try {
    await reserveQuota({
      scopeKey: deviceScopeKey,
      quotaDay,
      requestedBytes,
      maximumBytes: DOWNLOAD_LIMITS.deviceDailyBytes,
      maximumConcurrent: DOWNLOAD_LIMITS.deviceMaxConcurrent,
      leaseId,
      leaseExpiresAt,
      quotaExpiresAt
    });
    deviceQuotaReserved = true;

    await reserveQuota({
      scopeKey: ipScopeKey,
      quotaDay,
      requestedBytes,
      maximumBytes: DOWNLOAD_LIMITS.ipDailyBytes,
      maximumConcurrent: DOWNLOAD_LIMITS.ipMaxConcurrent,
      leaseId,
      leaseExpiresAt,
      quotaExpiresAt
    });
    ipQuotaReserved = true;
  } catch (error) {
    const rollbackTasks = [
      releaseCommandLease(
        authorizedCommand._id,
        leaseId,
        false,
        0,
        authorizedCommand.status
      )
    ];
    if (deviceQuotaReserved) {
      rollbackTasks.push(
        releaseQuota({
          scopeKey: deviceScopeKey,
          quotaDay,
          leaseId,
          refundBytes: requestedBytes
        })
      );
    }
    if (ipQuotaReserved) {
      rollbackTasks.push(
        releaseQuota({
          scopeKey: ipScopeKey,
          quotaDay,
          leaseId,
          refundBytes: requestedBytes
        })
      );
    }
    await Promise.allSettled(rollbackTasks);
    throw error;
  }

  let finalized = false;
  return {
    commandId: String(authorizedCommand._id),
    async finalize({ completed, bytesSent }) {
      if (finalized) return;
      finalized = true;

      const normalizedBytesSent = Math.max(
        0,
        Math.min(requestedBytes, Math.round(Number(bytesSent) || 0))
      );
      const refundBytes = requestedBytes - normalizedBytesSent;

      const quotaReleases = [];
      if (deviceQuotaReserved) {
        quotaReleases.push(
          releaseQuota({
            scopeKey: deviceScopeKey,
            quotaDay,
            leaseId,
            refundBytes
          })
        );
      }
      if (ipQuotaReserved) {
        quotaReleases.push(
          releaseQuota({
            scopeKey: ipScopeKey,
            quotaDay,
            leaseId,
            refundBytes
          })
        );
      }

      await Promise.all([
        ...quotaReleases,
        releaseCommandLease(
          authorizedCommand._id,
          leaseId,
          completed === true,
          normalizedBytesSent
        )
      ]);
    }
  };
}

module.exports = {
  reserveAuthorizedDummyDownload,
  DOWNLOAD_LIMITS
};
