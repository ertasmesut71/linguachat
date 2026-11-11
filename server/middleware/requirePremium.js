const requirePremium = (req, res, next) => {
  if (!req.user || req.user.subscriptionStatus !== "active") {
    return res.status(403).json({
      error: "Bu özellik yalnızca Premium üyeler için geçerlidir.",
      code: "PREMIUM_REQUIRED",
    });
  }
  next();
};

module.exports = { requirePremium };
