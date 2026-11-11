const store = require("../db/store");

// Reuses the shared Prisma client from the store instead of opening a second pool.
const prisma = store.prisma;

const requirePremium = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionStatus: true },
    });
    if (!user || user.subscriptionStatus !== "active") {
      return res.status(403).json({
        error: "Bu özellik yalnızca Premium üyeler için geçerlidir.",
        code: "PREMIUM_REQUIRED",
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requirePremium };
