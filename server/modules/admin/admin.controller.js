const adminService = require("./admin.service");

const adminController = {
  async promote(req, res, next) {
    try {
      const r = await adminService.promoteMember(req.params.chatId, req.userId, req.body.userId);
      res.json({ status: "success", data: { member: r } });
    } catch (e) { next(e); }
  },
  async demote(req, res, next) {
    try {
      const r = await adminService.demoteMember(req.params.chatId, req.userId, req.body.userId);
      res.json({ status: "success", data: { member: r } });
    } catch (e) { next(e); }
  },
  async mute(req, res, next) {
    try {
      const r = await adminService.muteMember(req.params.chatId, req.userId, req.body.userId);
      res.json({ status: "success", data: { member: r } });
    } catch (e) { next(e); }
  },
  async unmute(req, res, next) {
    try {
      const r = await adminService.unmuteMember(req.params.chatId, req.userId, req.body.userId);
      res.json({ status: "success", data: { member: r } });
    } catch (e) { next(e); }
  },
  async kick(req, res, next) {
    try {
      await adminService.kickMember(req.params.chatId, req.userId, req.params.userId);
      res.json({ status: "success", data: { kicked: true } });
    } catch (e) { next(e); }
  },
  async deleteMessage(req, res, next) {
    try {
      const r = await adminService.deleteMessage(req.params.chatId, req.userId, req.params.messageId);
      res.json({ status: "success", data: r });
    } catch (e) { next(e); }
  },
};

module.exports = adminController;
